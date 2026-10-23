// src/lib/device/secrets.ts - Protect device secrets with Windows DPAPI (Report 20 §2.6).
// The database key, device credential and Google refresh token are stored only in DPAPI-protected form, bound
// to the Windows user account. Secrets are passed to PowerShell on stdin, never on the command line.
import { spawn } from "node:child_process";

const script = (mode: string) => `
Add-Type -AssemblyName System.Security
$mode = '${mode}'
$in = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($in)
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$entropy = [Text.Encoding]::UTF8.GetBytes('pakistan-crm-device-v1')
if ($mode -eq 'protect') { $out = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope) }
else { $out = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope) }
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

export class SecretStoreError extends Error {}

export function dpapiAvailable(): boolean {
  return process.platform === "win32";
}

function runDpapi(mode: "protect" | "unprotect", inputB64: string): Promise<string> {
  if (!dpapiAvailable()) return Promise.reject(new SecretStoreError("DPAPI is only available on Windows"));
  return new Promise((resolve, reject) => {
    // -EncodedCommand takes no extra arguments, so the mode is part of the script text
    const encoded = Buffer.from(script(mode), "utf16le").toString("base64");
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true });
    let out = "";
    let err = "";
    ps.stdout.on("data", (d) => (out += d));
    ps.stderr.on("data", (d) => (err += d));
    ps.on("error", (e) => reject(new SecretStoreError(e.message)));
    ps.on("close", (code) => (code === 0 && out ? resolve(out.trim()) : reject(new SecretStoreError(`DPAPI ${mode} failed${err ? `: ${err.split("\n")[0]}` : ""}`))));
    ps.stdin.end(inputB64);
  });
}

/** Protect a secret for the current Windows user; returns base64 that is useless on another account or PC. */
export async function protectSecret(secret: string): Promise<string> {
  return runDpapi("protect", Buffer.from(secret, "utf8").toString("base64"));
}

export async function unprotectSecret(protectedB64: string): Promise<string> {
  return Buffer.from(await runDpapi("unprotect", protectedB64), "base64").toString("utf8");
}
