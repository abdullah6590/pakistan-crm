// desktop/app-entry.cjs - Started by the desktop shell. Reads this computer's settings from
// <data>\desktop.json, unlocks its secrets with Windows DPAPI (bound to this Windows user), sets the environment
// and starts the bundled Next.js standalone server. Secrets are never written in plain text.
//
// First start: a single-business local installation (role "cloud": this PC is its own main server) with a new
// database in <data>\data\crm.db. For a desktop that syncs with a main server, an administrator edits desktop.json:
//   { "role": "device", "upstreamUrl": "https://…", "deviceId": "…", "deviceCode": "D01", "tenantId": "…",
//     "plain": { "deviceSecret": "<shown once at registration>" } }
// The next start moves anything under "plain" into "protected" (DPAPI) and removes the plain copy.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const DPAPI = (mode) => `
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($in)
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$entropy = [Text.Encoding]::UTF8.GetBytes('pakistan-crm-device-v1')
${mode === "protect" ? "$out = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)" : "$out = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)"}
[Console]::Out.Write([Convert]::ToBase64String($out))
`;
function dpapi(mode, b64) {
  const encoded = Buffer.from(DPAPI(mode), "utf16le").toString("base64");
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { input: b64, windowsHide: true }).toString().trim();
}
const protect = (s) => dpapi("protect", Buffer.from(s, "utf8").toString("base64"));
const unprotect = (b64) => Buffer.from(dpapi("unprotect", b64), "base64").toString("utf8");

const data = process.env.CRM_DESKTOP_DATA;
if (!data) throw new Error("CRM_DESKTOP_DATA is not set (the desktop shell sets it)");
const configFile = path.join(data, "desktop.json");
let config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : { role: "cloud" };
config.protected ??= {};
let changed = !fs.existsSync(configFile);
// Secrets typed in plain text by an administrator are protected on first sight
for (const [k, v] of Object.entries(config.plain ?? {})) {
  if (v) config.protected[k] = protect(String(v));
  changed = true;
}
delete config.plain;
if (!config.protected.jwtSecret) {
  config.protected.jwtSecret = protect(crypto.randomBytes(48).toString("hex"));
  changed = true;
}
if (config.role !== "cloud" && !config.protected.dbKey) {
  config.protected.dbKey = protect(crypto.randomBytes(32).toString("hex")); // desktops keep their database encrypted
  changed = true;
}
config.database ??= path.join(data, "data", "crm.db");
if (changed) fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
fs.mkdirSync(path.dirname(config.database), { recursive: true });

const secret = (k) => (config.protected[k] ? unprotect(config.protected[k]) : undefined);
const set = (k, v) => { if (v !== undefined && v !== null && v !== "") process.env[k] = String(v); };
process.env.NODE_ENV = "production";
set("DATABASE_URL", `file:${config.database.replace(/\\/g, "/")}`);
set("JWT_SECRET", secret("jwtSecret"));
set("CRM_NODE_ROLE", config.role);
set("CRM_DB_ENCRYPTION_KEY", secret("dbKey"));
set("CRM_UPSTREAM_URL", config.upstreamUrl);
set("CRM_DEVICE_ID", config.deviceId);
set("CRM_DEVICE_CODE", config.deviceCode);
set("CRM_DEVICE_SECRET", secret("deviceSecret"));
set("CRM_TENANT_ID", config.tenantId);
set("GOOGLE_OAUTH_CLIENT_ID", config.googleClientId);
process.env.CRM_AUTO_MIGRATE = "1"; // bring this computer's database up to this version before serving

// The server keeps copies of rendered pages in the program folder. They name the style and script files of the
// version that made them, so after an upgrade they would show pages without styling (D-036). They are only a
// cache: clear them before every start; pages are rendered again on demand.
fs.rmSync(path.join(__dirname, ".next-desktop", "server", "route-cache"), { recursive: true, force: true });

require(path.join(__dirname, "server.js"));
