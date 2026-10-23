// One running Pakistan CRM per data folder (and so per Windows user, whose data folder is their own).
//
// The lock is <data>\instance.lock held open with write access and no write sharing. Windows releases it the moment
// this process ends in any way (closed, crashed, killed, or the computer restarted), so a lock left behind by a crash
// can never block the next start: the file stays, but nobody holds it. The holder writes its process id into the
// file; a second launch reads it, brings that process's window to the front, and exits before starting a server or
// opening the database.
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const WINDOW_TITLE: &str = "Pakistan CRM";

/// How long a second launch keeps trying before it gives up: it covers an app that is still opening its window and
/// one that is still closing (whose lock is released when it has fully ended).
const WAIT: Duration = Duration::from_secs(10);

/// Held for the life of the process; dropping it (or the process ending) releases the lock.
pub struct InstanceLock(#[allow(dead_code)] File);

pub enum Outcome {
    /// This process owns the data folder and should start normally
    First(InstanceLock),
    /// Another process owns it; this one has done what it could and must exit
    AlreadyRunning,
}

fn try_lock(file: &Path) -> std::io::Result<Option<InstanceLock>> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    match OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(FILE_SHARE_READ).open(file) {
        Ok(mut f) => {
            f.set_len(0)?;
            f.seek(SeekFrom::Start(0))?;
            write!(f, "{}", std::process::id())?;
            f.flush()?;
            Ok(Some(InstanceLock(f)))
        }
        Err(e) if e.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => Ok(None),
        Err(e) => Err(e),
    }
}

/// The process id written by the current holder, if it has written it yet.
fn holder_pid(file: &Path) -> Option<u32> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ_WRITE: u32 = 1 | 2;
    let mut s = String::new();
    OpenOptions::new().read(true).share_mode(FILE_SHARE_READ_WRITE).open(file).ok()?.read_to_string(&mut s).ok()?;
    s.trim().parse().ok()
}

pub fn log(data: &Path, line: &str) {
    let _ = std::fs::create_dir_all(data.join("logs"));
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(data.join("logs").join("instance.log")) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{secs} pid {}: {line}", std::process::id());
    }
}

/// Message boxes are skipped when CRM_DESKTOP_NO_DIALOGS=1 (automated tests); the text still goes to the log.
pub fn tell(data: &Path, text: &str) {
    log(data, text);
    if std::env::var("CRM_DESKTOP_NO_DIALOGS").as_deref() == Ok("1") {
        return;
    }
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (text, title) = (wide(text), wide(WINDOW_TITLE));
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND) };
}

/// The visible main window of process `pid`, if it has one.
fn main_window(pid: u32) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};
    struct Search {
        pid: u32,
        found: HWND,
    }
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> i32 {
        let search = unsafe { &mut *(lparam as *mut Search) };
        let mut owner = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut owner) };
        if owner != search.pid || unsafe { IsWindowVisible(hwnd) } == 0 {
            return 1;
        }
        let mut buf = [0u16; 64];
        let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if String::from_utf16_lossy(&buf[..n.max(0) as usize]) == WINDOW_TITLE {
            search.found = hwnd;
            return 0; // stop
        }
        1
    }
    let mut search = Search { pid, found: std::ptr::null_mut() };
    unsafe { EnumWindows(Some(each), &mut search as *mut Search as LPARAM) };
    (!search.found.is_null()).then_some(search.found)
}

/// Restore the window if minimised and bring it to the front. Windows may refuse the front (it limits which
/// programs can take focus); the taskbar button then flashes instead and the caller tells the user.
fn bring_forward(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FlashWindowEx, IsIconic, SetForegroundWindow, ShowWindow, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG, SW_RESTORE,
    };
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(hwnd) != 0 {
            return true;
        }
        let info = FLASHWINFO { cbSize: std::mem::size_of::<FLASHWINFO>() as u32, hwnd, dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG, uCount: 0, dwTimeout: 0 };
        FlashWindowEx(&info);
    }
    false
}

/// Take the data folder for this process, or hand over to the instance that already has it.
pub fn claim(data: &Path) -> Result<Outcome, String> {
    std::fs::create_dir_all(data).map_err(|e| format!("Pakistan CRM could not open its data folder {}: {e}", data.display()))?;
    let file: PathBuf = data.join("instance.lock");
    let started = Instant::now();
    let mut announced = false;
    loop {
        match try_lock(&file) {
            Ok(Some(lock)) => {
                log(data, if announced { "started after the previous instance finished closing" } else { "started" });
                return Ok(Outcome::First(lock));
            }
            Ok(None) => {}
            Err(e) if e.kind() == ErrorKind::PermissionDenied => {
                return Err(format!("Pakistan CRM could not use its data folder {} (access denied).", data.display()))
            }
            Err(e) => return Err(format!("Pakistan CRM could not check whether it is already running: {e}")),
        }
        if !announced {
            log(data, "already running; handing over to the open window");
            announced = true;
        }
        if let Some(pid) = holder_pid(&file) {
            if let Some(hwnd) = main_window(pid) {
                if bring_forward(hwnd) {
                    log(data, &format!("brought the open window of pid {pid} to the front; exiting"));
                } else {
                    tell(data, "Pakistan CRM is already open. Windows did not allow it to come to the front, so its button on the taskbar is flashing: click it to continue.");
                }
                return Ok(Outcome::AlreadyRunning);
            }
        }
        if started.elapsed() > WAIT {
            tell(data, "Pakistan CRM is already running, but its window could not be found. It may still be starting or closing: wait a moment and open it again. If this keeps happening, restart the computer; your saved and unsent entries are kept.");
            return Ok(Outcome::AlreadyRunning);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}
