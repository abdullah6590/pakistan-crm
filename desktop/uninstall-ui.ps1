# desktop/uninstall-ui.ps1 - Drive an uninstaller window the way a person would: tick "Delete the application data",
# press Uninstall, acknowledge any message, and close it. Used by installer-test.mjs on a TEST edition only.
# NSIS dialogs are plain Win32 controls (UI Automation sees them only as panes), so they are found by text and
# operated with the standard button messages. Always prints one JSON line and exits 0; the caller judges the result.
param([string]$uninstaller, [string]$titleLike)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class U {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
}
"@
$BM_GETCHECK = 0xF0; $BM_SETCHECK = 0xF1; $WM_COMMAND = 0x111
$root = [Windows.Automation.AutomationElement]::RootElement
$all = [Windows.Automation.Condition]::TrueCondition
$log = @()
function Out($ok, $ticked, $message) { @{ ok = $ok; ticked = $ticked; message = $message; log = $log } | ConvertTo-Json -Compress; exit 0 }
function TopWindows([string]$like) { @($root.FindAll([Windows.Automation.TreeScope]::Children, $all) | Where-Object { $_.Current.ClassName -eq "#32770" -and $_.Current.Name -like $like }) }
function Control($win, [string]$class, [string]$name) {
  foreach ($e in $win.FindAll([Windows.Automation.TreeScope]::Descendants, $all)) { if ($e.Current.ClassName -eq $class -and $e.Current.Name -like $name) { return $e } }
  return $null
}
function Click($win, $button) {
  # A button press as its own dialog receives it: WM_COMMAND with the button's id, sent to the button's parent
  # (a message box sits inside the uninstaller window in the UI tree, but is a dialog of its own)
  $h = [IntPtr]$button.Current.NativeWindowHandle
  [U]::PostMessage([U]::GetParent($h), $WM_COMMAND, [IntPtr][U]::GetDlgCtrlID($h), $h) | Out-Null
}

Start-Process -FilePath $uninstaller | Out-Null
$win = $null
for ($i = 0; $i -lt 80 -and -not $win; $i++) { $win = TopWindows $titleLike | Select-Object -First 1; if (-not $win) { Start-Sleep -Milliseconds 250 } }
if (-not $win) { $log += "uninstaller window not found"; Out $false $false "" }
$log += "window: $($win.Current.Name.Trim())"

$box = Control $win "Button" "*application data*"
if (-not $box) { $log += "delete-data box not found"; Out $false $false "" }
$bh = [IntPtr]$box.Current.NativeWindowHandle
[U]::SendMessage($bh, $BM_SETCHECK, [IntPtr]1, [IntPtr]::Zero) | Out-Null
$ticked = ([U]::SendMessage($bh, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero)).ToInt32() -eq 1
$log += "ticked '$($box.Current.Name)': $ticked"

Click $win (Control $win "Button" "Uninstall")
$log += "pressed Uninstall"
$message = ""
for ($i = 0; $i -lt 240; $i++) {
  Start-Sleep -Milliseconds 250
  # Only dialog windows (#32770): searching every window's controls (an IDE has thousands) would take minutes
  foreach ($w in $root.FindAll([Windows.Automation.TreeScope]::Children, $all) | Where-Object { $_.Current.ClassName -eq "#32770" }) {
    $t = Control $w "Static" "*does not delete business data*"
    if ($t -and -not $message) { $message = $t.Current.Name; Click $w (Control $w "Button" "OK"); $log += "message acknowledged" }
  }
  if (-not (TopWindows $titleLike)) { $log += "uninstaller finished and closed"; break }
  $win = TopWindows $titleLike | Where-Object { Control $_ "Button" "Close" } | Select-Object -First 1
  if ($win) {
    $close = Control $win "Button" "Close"
    if ([U]::IsWindowEnabled([IntPtr]$close.Current.NativeWindowHandle)) { Click $win $close; $log += "closed"; break }
  }
}
Out $ticked $ticked $message
