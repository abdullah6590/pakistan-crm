// src/lib/backup/picker-access.ts - Who may be shown the Windows folder picker (it opens on the computer running the app).

/**
 * Whether the Windows folder picker can be shown to this user: it opens on the computer running Pakistan CRM, so it is
 * offered on desktops and office servers, and on the website only when the page is opened on that same Windows
 * computer (localhost) and the app is not the hosted online service.
 */
export function folderPickerAllowed(host: string | null | undefined, role: string) {
  if (process.platform !== "win32") return false;
  if (role !== "cloud") return true;
  if (process.env.CRM_DEPLOYMENT_PROFILE === "hosted-multi") return false;
  const name = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
