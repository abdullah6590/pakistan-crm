// Pakistan CRM desktop shell (Report 20 §3). It starts the bundled local server (Node + the Next.js standalone
// build) on a free port bound to 127.0.0.1 only, waits until /api/health answers, then shows it in a window. Closing
// the app stops the server. Business logic, offline queue, sync and backups all live in the server; this shell adds
// nothing to them.
//
// Only one copy runs per data folder (instance.rs): a second launch brings the open window forward and exits before
// it starts a server or touches the database.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod instance;

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// The local server, and whether the app has begun closing (a server that finishes starting after that is stopped).
#[derive(Default)]
struct Server {
    child: Option<Child>,
    closing: bool,
}
struct ServerState(Mutex<Server>);

/// Windows job object that kills the server when the app ends in ANY way (closed, crashed or force-killed).
#[cfg(windows)]
fn tie_to_app(child: &Child) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size) == 0
            || AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        // The job handle is deliberately never closed: Windows closes it when this app ends, which ends the server
    }
    Ok(())
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// True when OUR server answers its health check: the reply must carry this launch's random token, so another
/// program that happens to hold the port is never mistaken for it.
fn healthy(port: u16, token: &str) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = s.read_to_string(&mut body);
    body.starts_with("HTTP/1.1 200") && body.contains("\"ok\"") && body.contains(&format!("\"instance\":\"{token}\""))
}

fn launch_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u32(std::process::id());
    format!("{:016x}", h.finish())
}

/// Tauri reports installed folders in Windows "verbatim" form (\\?\C:\...), which Node cannot start a script
/// from (D-029). Ordinary drive paths are returned without that prefix; anything else is left unchanged.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p,
    }
}

/// This Windows user's data folder: the same one Tauri's app_data_dir() gives (%APPDATA%\<identifier>).
fn data_dir(identifier: &str) -> Option<PathBuf> {
    match std::env::var("CRM_DESKTOP_DATA_DIR") {
        Ok(d) => Some(PathBuf::from(d)),
        Err(_) => dirs::data_dir().map(|d| d.join(identifier)),
    }
}

struct Paths {
    app_dir: PathBuf,
    node: PathBuf,
    data: PathBuf,
}

/// Start the server and wait until it is healthy. A port taken by someone else between choosing and binding it
/// makes the server exit at once; that attempt is retried on a new port (up to three in all).
fn start_server(app: &AppHandle, paths: &Paths) -> Result<u16, String> {
    let logs = paths.data.join("logs");
    let log_file = logs.join("server.log");
    let log = fs::File::create(&log_file).map_err(|e| format!("Could not write {}: {e}", log_file.display()))?;
    let token = launch_token();
    let preferred = std::env::var("CRM_DESKTOP_PREFERRED_PORT").ok().and_then(|p| p.parse::<u16>().ok());
    let mut last_error = String::new();
    for attempt in 1..=3 {
        let port = match (attempt, preferred) {
            (1, Some(p)) => p,
            _ => free_port().map_err(|e| format!("No free local port: {e}"))?,
        };
        instance::log(&paths.data, &format!("starting the local server on 127.0.0.1:{port} (attempt {attempt})"));
        let out = log.try_clone().map_err(|e| e.to_string())?;
        let err = log.try_clone().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&paths.node);
        cmd.arg(paths.app_dir.join("app-entry.cjs"))
            .current_dir(&paths.app_dir)
            .env("PORT", port.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("CRM_DESKTOP_DATA", &paths.data)
            .env("CRM_DESKTOP_INSTANCE", &token)
            .stdin(Stdio::null())
            .stdout(Stdio::from(out))
            .stderr(Stdio::from(err));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console window for the server
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start the local server: {e}"))?;
        #[cfg(windows)]
        if let Err(e) = tie_to_app(&child) {
            let _ = child.kill();
            return Err(format!("Could not supervise the local server: {e}"));
        }
        {
            let state = app.state::<ServerState>();
            let mut s = state.0.lock().unwrap();
            if s.closing {
                let _ = child.kill();
                return Err("closing".into());
            }
            s.child = Some(child);
        }

        let started = Instant::now();
        loop {
            if healthy(port, &token) {
                return Ok(port);
            }
            let exited = {
                let state = app.state::<ServerState>();
                let mut s = state.0.lock().unwrap();
                match s.child.as_mut() {
                    None => return Err("closing".into()), // the app is closing and took the server
                    Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                }
            };
            if exited {
                last_error = format!("The local server stopped while starting (attempt {attempt}); see {}", log_file.display());
                instance::log(&paths.data, &last_error);
                break;
            }
            if started.elapsed() > Duration::from_secs(120) {
                let state = app.state::<ServerState>();
                if let Some(mut c) = state.0.lock().unwrap().child.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                return Err(format!("The local server did not start within 2 minutes; see {}", log_file.display()));
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }
    Err(last_error)
}

fn show_problem(app: &AppHandle, data: &Path, message: &str) {
    instance::log(data, message);
    if let Some(w) = app.get_webview_window("main") {
        let quoted = format!("{:?}", message); // a Rust debug string is a valid JavaScript string literal for this text
        let _ = w.eval(format!("window.showProblem && window.showProblem({quoted})"));
    }
}

fn main() {
    let context = tauri::generate_context!();
    let Some(data) = data_dir(&context.config().identifier) else {
        instance::tell(Path::new("."), "Pakistan CRM could not find this Windows user's application-data folder.");
        return;
    };
    // Before anything else: a second copy hands over to the first and ends here, having started nothing
    // Held until the process ends; Windows releases it then, however the process ends
    let _lock = match instance::claim(&data) {
        Ok(instance::Outcome::First(lock)) => lock,
        Ok(instance::Outcome::AlreadyRunning) => return,
        Err(message) => {
            instance::tell(&data, &message);
            return;
        }
    };
    let _ = fs::remove_file(data.join("logs").join("port.txt")); // a port file is only ever the running server's

    let setup_data = data.clone();
    let app = tauri::Builder::default()
        .manage(ServerState(Mutex::new(Server::default())))
        .setup(move |app| {
            let resources = plain(app.path().resource_dir()?);
            // Overrides exist for development and the tests; an installed app uses its own resources and data
            let paths = Paths {
                app_dir: std::env::var("CRM_DESKTOP_APP_DIR").map(PathBuf::from).unwrap_or(resources.join("app")),
                node: std::env::var("CRM_DESKTOP_NODE").map(PathBuf::from).unwrap_or(resources.join("node").join("node.exe")),
                data: setup_data,
            };
            fs::create_dir_all(paths.data.join("logs"))?;
            // The window appears at once with "Starting…", so a second launch always finds something to bring forward
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(instance::WINDOW_TITLE)
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || match start_server(&handle, &paths) {
                Ok(port) => {
                    let _ = fs::write(paths.data.join("logs").join("port.txt"), port.to_string());
                    instance::log(&paths.data, &format!("local server ready on 127.0.0.1:{port}"));
                    let url: tauri::Url = format!("http://127.0.0.1:{port}/login").parse().expect("valid local URL");
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.navigate(url);
                    }
                }
                Err(e) if e == "closing" => {}
                Err(e) => show_problem(&handle, &paths.data, &e),
            });
            Ok(())
        })
        .build(context)
        .expect("error while building the Pakistan CRM desktop app");
    let exit_data = data.clone();
    app.run(move |app, event| {
        if let RunEvent::Exit = event {
            let state = app.state::<ServerState>();
            let mut s = state.0.lock().unwrap();
            s.closing = true;
            if let Some(mut child) = s.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            instance::log(&exit_data, "closed; local server stopped");
        }
    });
}
