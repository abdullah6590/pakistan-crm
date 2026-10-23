// desktop/instance-test.mjs - Windows tests for single-instance protection and isolation (Report 26, desktop I-01..I-10).
// Runs the real desktop app (built or installed) against throw-away data folders, with a throw-away main server, so
// that there are genuinely unsent offline entries to protect. Never touches crm.db, the owner's desktop data or any
// process it did not start. Usage: node instance-test.mjs [path-to-exe] [installed]
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.join(here, "..");
const exe = process.argv[2] ?? path.join(here, "src-tauri", "target", "release", "pakistan-crm-desktop.exe");
const installed = !!process.argv[3];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "crm-instance-test-"));
const dataA = path.join(work, "user-a");
const dataB = path.join(work, "user-b");
const results = [];
const check = (id, title, pass, evidence) => { results.push({ id, title, pass: !!pass, evidence }); console.log(`${pass ? "PASS" : "FAIL"} ${id} ${title}\n     ${evidence}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 60_000, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  return null;
}
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
// Always a list: piping a one-item list to ConvertTo-Json gives a bare value (the D-028 trap), so pass it whole
const psList = (expr) => { const out = ps(`ConvertTo-Json -Compress -InputObject @(${expr})`); const v = out ? JSON.parse(out) : []; return Array.isArray(v) ? v : [v]; };
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

// ---- Windows helpers -------------------------------------------------------------------------------------------
const WIN = path.join(work, "win.ps1");
fs.writeFileSync(WIN, `param([string]$action, [int]$procId)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(64); GetWindowText(h, sb, 64); if (sb.ToString() == "Pakistan CRM") { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
$h = [W]::Find([uint32]$procId)
if ($action -eq "minimize" -and $h -ne [IntPtr]::Zero) { [W]::ShowWindow($h, 6) | Out-Null; Start-Sleep -Milliseconds 400 }
$fgPid = [uint32]0; [W]::GetWindowThreadProcessId([W]::GetForegroundWindow(), [ref]$fgPid) | Out-Null
@{ found = ($h -ne [IntPtr]::Zero); minimized = ($h -ne [IntPtr]::Zero -and [W]::IsIconic($h)); foreground = ($fgPid -eq $procId) } | ConvertTo-Json -Compress
`);
const windowState = (pid, action = "state") => JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", WIN, action, String(pid)], { encoding: "utf8" }).trim());
/** Local servers started by one app process (its node.exe children running app-entry.cjs). */
const serversOf = (appPid) => psList(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ParentProcessId -eq ${appPid} -and $_.CommandLine -like '*app-entry.cjs*' } | ForEach-Object { $_.ProcessId }`);
const allServers = () => psList(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*app-entry.cjs*' } | ForEach-Object { $_.ProcessId }`);
const listening = (pid) => psList(`Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }`);
const alive = (pid) => Number.isInteger(pid) && ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`) === "yes";
const instanceLog = (data) => { const f = path.join(data, "logs", "instance.log"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; };
function hashTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = path.join(e.parentPath ?? e.path, e.name);
    out[path.relative(dir, f)] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
  }
  return out;
}

// ---- The app and the throw-away main server -----------------------------------------------------------------
const baseEnv = { ...process.env, CRM_DESKTOP_NO_DIALOGS: "1", CRM_SYNC_INTERVAL_MS: "2000" };
if (!installed) { baseEnv.CRM_DESKTOP_APP_DIR = path.join(here, "bundle", "app"); baseEnv.CRM_DESKTOP_NODE = path.join(here, "bundle", "node", "node.exe"); }
function launch(data, extra = {}) {
  const child = spawn(exe, [], { env: { ...baseEnv, CRM_DESKTOP_DATA_DIR: data, ...extra }, stdio: "ignore" });
  child.exited = new Promise((resolve) => { child.on("exit", (code) => resolve(code)); child.on("error", () => resolve("could not start")); });
  return child;
}
async function ready(data) {
  const portFile = path.join(data, "logs", "port.txt");
  const port = await until(() => fs.existsSync(portFile) && fs.readFileSync(portFile, "utf8").trim(), 150_000);
  if (!port) throw new Error(`the app did not become ready; log:\n${instanceLog(data)}`);
  return Number(port);
}
/** Relaunch after the previous app has ended: its port file is stale and must not be mistaken for the new one. */
const relaunch = (data, extra) => { fs.rmSync(path.join(data, "logs", "port.txt"), { force: true }); return launch(data, extra); };
const exitedWithin = (child, ms) => Promise.race([child.exited.then((code) => ({ code })), sleep(ms).then(() => null)]);
const stopHard = (pid) => { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} };

async function call(base, method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `auth-token=${cookie}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const m = (res.headers.get("set-cookie") || "").match(/auth-token=([^;]*)/);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, token: m ? m[1] : null };
}
const cloudPort = await freePort();
const CLOUD = `http://127.0.0.1:${cloudPort}`;
const cloudEnv = { ...process.env, CRM_NODE_ROLE: "cloud", DATABASE_URL: `file:${path.join(work, "main-server.db").replace(/\\/g, "/")}`, JWT_SECRET: crypto.randomBytes(48).toString("hex"), CRM_AUTO_MIGRATE: "1" };
function startCloud() {
  const log = fs.openSync(path.join(work, "main-server.log"), "a");
  return spawn(process.execPath, [path.join(PROJ, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(cloudPort), "-H", "127.0.0.1"], { cwd: PROJ, env: cloudEnv, stdio: ["ignore", log, log], windowsHide: true });
}
const cloudUp = () => until(async () => { try { return (await fetch(`${CLOUD}/login`)).status === 200; } catch { return false; } }, 120_000, 1000);

// Other software that must not be disturbed: the node processes already running, and one more we start ourselves
const otherNodes = psList(`Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }`);
const otherPort = await freePort();
const other = spawn(process.execPath, ["-e", `require("http").createServer((q,s)=>s.end("other app")).listen(${otherPort},"127.0.0.1")`], { stdio: "ignore", windowsHide: true });
const ownerData = path.join(process.env.APPDATA, "pk.pakistancrm.desktop");
const ownerBefore = hashTree(ownerData);
const servicesBefore = ps(`@(Get-Service | Where-Object { $_.Name -like '*pakistan*' -or $_.DisplayName -like '*Pakistan*' }).Count`);

let cloud = startCloud();
const apps = [];
try {
  await cloudUp();
  const pw = `It-${crypto.randomBytes(4).toString("hex")}-pw`;
  const O = (await call(CLOUD, "POST", "/api/auth/register", { body: { name: "Owner", email: "owner@shop.test", password: pw } })).token;
  await call(CLOUD, "POST", "/api/users", { cookie: O, body: { name: "Clerk", email: "clerk@shop.test", password: pw, role: "EMPLOYEE" } });
  const cat = await call(CLOUD, "POST", "/api/categories", { cookie: O, body: { name: "Cups" } });
  const item = (await call(CLOUD, "POST", "/api/inventory", { cookie: O, body: { name: "Paper cup", categoryId: cat.json.category.id, quantity: 0, unitCost: 0, unitPrice: 0 } })).json.component.id;
  await call(CLOUD, "PUT", `/api/accounting/items/${item}/units`, { cookie: O, body: { kind: "PIECE", baseUnit: "piece", baseDecimals: 0, confirmed: true, saleUnit: "carton", purchaseUnit: "carton", conversions: [{ code: "carton", factor: 2000 }] } });
  const acct = async (name, kind, subType) => (await call(CLOUD, "POST", "/api/accounting/accounts", { cookie: O, body: { name, kind, subType } })).json.account.id;
  const customer = await acct("Ali Traders", "PARTY", "CUSTOMER");
  const supplier = await acct("Cup Mills", "PARTY", "SUPPLIER");
  await call(CLOUD, "POST", "/api/accounting/documents", { cookie: O, body: { type: "PURCHASE_INVOICE", date: "2026-10-22", partyAccountId: supplier, lines: [{ componentId: item, quantity: 10, unit: "carton", unitPrice: 8261 }] } });
  const reg = await call(CLOUD, "POST", "/api/sync/devices", { cookie: O, body: { name: "Counter PC", role: "DEVICE" } });

  // This desktop syncs with the throw-away main server (its secret goes in "plain" and is DPAPI-protected on start)
  fs.mkdirSync(dataA, { recursive: true });
  fs.writeFileSync(path.join(dataA, "desktop.json"), JSON.stringify({ role: "device", upstreamUrl: CLOUD, deviceId: reg.json.device.id, deviceCode: reg.json.device.code, tenantId: reg.json.tenantId, plain: { deviceSecret: reg.json.secret } }, null, 2));

  // I-01 / I-02: first launch, and a second launch while the first is still starting
  let a = launch(dataA); apps.push(a);
  await sleep(1500);
  const early = launch(dataA);
  const earlyExit = await exitedWithin(early, 20_000);
  let port = await ready(dataA);
  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  const serversA = serversOf(a.pid);
  const binds = serversA.length ? listening(serversA[0]) : [];
  check("I-01", "First launch starts one local server, listening on 127.0.0.1 only, and opens its window",
    health.status === "ok" && serversA.length === 1 && binds.length > 0 && binds.every((b) => b.startsWith("127.0.0.1:")) && windowState(a.pid).found,
    `port ${port}; servers ${serversA.length}; listening on ${binds.join(", ")}; window found ${windowState(a.pid).found}`);
  check("I-02", "A second launch while the first is still starting exits without starting anything",
    earlyExit?.code === 0 && serversOf(early.pid).length === 0 && serversOf(a.pid).length === 1,
    `second exited ${earlyExit ? `with code ${earlyExit.code}` : "NOT within 20 s"}; servers of the first ${serversOf(a.pid).length}`);

  // The desktop downloads its first copy; then the "internet" goes away and two entries are made offline
  const C = await until(async () => { const r = await call(`http://127.0.0.1:${port}`, "POST", "/api/auth/login", { body: { email: "clerk@shop.test", password: pw } }); return r.status === 200 ? r.token : null; }, 90_000, 1500);
  execSync(`taskkill /PID ${cloud.pid} /T /F`, { stdio: "ignore" });
  await sleep(1500);
  let base = `http://127.0.0.1:${port}`;
  const s1 = await call(base, "POST", "/api/accounting/documents", { cookie: C, body: { type: "SALE_INVOICE", date: "2026-10-23", partyAccountId: customer, lines: [{ componentId: item, quantity: 1, unit: "carton", unitPrice: 9000 }] } });
  const s2 = await call(base, "POST", "/api/accounting/documents", { cookie: C, body: { type: "SALE_INVOICE", date: "2026-10-23", partyAccountId: customer, lines: [{ componentId: item, quantity: 2, unit: "carton", unitPrice: 9000 }] } });
  const pendingRefs = [s1.json?.entry?.provisionalRef, s2.json?.entry?.provisionalRef];
  const outbox = async () => {
    const tok = (await call(base, "POST", "/api/auth/login", { body: { email: "clerk@shop.test", password: pw } })).token;
    const r = await call(base, "GET", "/api/sync/outbox", { cookie: tok });
    return (r.json?.entries ?? []).map((e) => `${e.provisionalRef}:${e.status}`).sort();
  };
  const unsent = (list) => list.length === 2 && list.every((e) => /:(PENDING_SYNC|FAILED_RETRY|SYNCING)$/.test(e));

  // I-03: second launch while running (window minimised first): no new server, no change to the running one
  const serverPid = serversOf(a.pid)[0];
  const logFile = path.join(dataA, "logs", "server.log");
  const logBefore = fs.statSync(logFile);
  windowState(a.pid, "minimize");
  const minimised = windowState(a.pid).minimized;
  const second = launch(dataA);
  const secondExit = await exitedWithin(second, 20_000);
  await sleep(500);
  const after2 = windowState(a.pid);
  const logAfter = fs.statSync(logFile);
  const handover = instanceLog(dataA).split("\n").filter((l) => l.includes(`pid ${second.pid}:`));
  check("I-03", "A second launch while running brings the open window back and exits; no second server, database or log",
    s1.status === 201 && s2.status === 201 && secondExit?.code === 0 && serversOf(a.pid).length === 1 && serversOf(a.pid)[0] === serverPid &&
      allServers().filter((p) => p === serverPid).length === 1 && logAfter.size === logBefore.size && logAfter.mtimeMs === logBefore.mtimeMs && minimised && !after2.minimized &&
      fs.readFileSync(path.join(dataA, "logs", "port.txt"), "utf8").trim() === String(port),
    `exit ${secondExit?.code}; same server ${serversOf(a.pid)[0] === serverPid}; server log untouched ${logAfter.size === logBefore.size}; minimised before ${minimised}, restored ${!after2.minimized}, in front ${after2.foreground}; log: ${handover.map((l) => l.replace(/^\d+ pid \d+: /, "")).join(" | ")}`);

  // I-04: close normally, reopen; entries kept
  const before4 = await outbox();
  try { execSync(`taskkill /PID ${a.pid}`, { stdio: "ignore" }); } catch {}
  const closed = await exitedWithin(a, 20_000);
  await sleep(1000);
  const serverGone = !alive(serverPid);
  a = relaunch(dataA); apps.push(a);
  port = await ready(dataA); base = `http://127.0.0.1:${port}`;
  const after4 = await outbox();
  check("I-04", "Closing normally stops the server; reopening works and both unsent entries are still waiting",
    !!closed && serverGone && unsent(before4) && unsent(after4) && JSON.stringify(before4.map((e) => e.split(":")[0])) === JSON.stringify(after4.map((e) => e.split(":")[0])),
    `closed ${!!closed}; server stopped ${serverGone}; before ${before4.join(", ")}; after ${after4.join(", ")}`);

  // I-05: crash (only the app killed), then an immediate relaunch: the lock is not stale; entries kept
  const server5 = serversOf(a.pid)[0];
  execSync(`taskkill /PID ${a.pid} /F`, { stdio: "ignore" });
  await a.exited;
  const t5 = Date.now();
  a = relaunch(dataA); apps.push(a);
  port = await ready(dataA); base = `http://127.0.0.1:${port}`;
  const after5 = await outbox();
  check("I-05", "After a crash the next launch starts at once (no stale lock); the crashed server is gone; entries kept",
    !alive(server5) && serversOf(a.pid).length === 1 && unsent(after5) && !/already running/.test(instanceLog(dataA).split("\n").filter((l) => l.includes(`pid ${a.pid}:`)).join("\n")),
    `old server stopped ${!alive(server5)}; ready again in ${Math.round((Date.now() - t5) / 1000)} s; entries ${after5.join(", ")}`);

  // I-06: the previously used port is taken by another program; the app moves to a new port and leaves it alone
  const oldPort = port;
  try { execSync(`taskkill /PID ${a.pid}`, { stdio: "ignore" }); } catch {}
  await exitedWithin(a, 20_000);
  await sleep(1000);
  const squatter = net.createServer((s) => s.on("error", () => {}).end("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}")).listen(oldPort, "127.0.0.1");
  await sleep(300);
  a = relaunch(dataA, { CRM_DESKTOP_PREFERRED_PORT: String(oldPort) }); apps.push(a);
  port = await ready(dataA); base = `http://127.0.0.1:${port}`;
  const squatterOk = await new Promise((resolve) => { const s = net.connect(oldPort, "127.0.0.1", () => { s.destroy(); resolve(true); }); s.on("error", () => resolve(false)); });
  const attempts = instanceLog(dataA).split("\n").filter((l) => l.includes(`pid ${a.pid}:`) && /attempt|stopped while starting/.test(l));
  check("I-06", "When its previous port is occupied it starts on another port, and the other program keeps its port",
    port !== oldPort && squatterOk && (await (await fetch(`${base}/api/health`)).json()).status === "ok" && (await outbox()).length === 2,
    `previous ${oldPort} (occupied, imitating a health answer) -> now ${port}; other program still listening ${squatterOk}; ${attempts.map((l) => l.replace(/^\d+ pid \d+: /, "")).join(" | ")}`);
  squatter.close();

  // I-07: another Windows user (own data folder) runs at the same time, separately
  const b = launch(dataB); apps.push(b);
  const portB = await ready(dataB);
  const cfgA = JSON.parse(fs.readFileSync(path.join(dataA, "desktop.json"), "utf8"));
  const cfgB = JSON.parse(fs.readFileSync(path.join(dataB, "desktop.json"), "utf8"));
  const healthB = await (await fetch(`http://127.0.0.1:${portB}/api/health`)).json();
  check("I-07", "A second user's copy (its own data folder) runs at the same time with its own server, port and database",
    portB !== port && serversOf(b.pid).length === 1 && serversOf(a.pid).length === 1 && cfgA.database !== cfgB.database && cfgB.database.startsWith(dataB) && healthB.role === "cloud" && (await (await fetch(`${base}/api/health`)).json()).role === "device",
    `user A port ${port} (device), user B port ${portB} (${healthB.role}); databases ${path.relative(work, cfgA.database)} / ${path.relative(work, cfgB.database)}`);
  try { execSync(`taskkill /PID ${b.pid}`, { stdio: "ignore" }); } catch {}
  await exitedWithin(b, 20_000);

  // I-08: the internet is back: the two entries are sent exactly once
  cloud = startCloud();
  await cloudUp();
  const synced = await until(async () => { const l = await outbox(); return l.length === 2 && l.every((e) => e.endsWith(":SYNCED")) ? l : null; }, 90_000, 2000);
  const docs = await call(CLOUD, "GET", "/api/accounting/documents?type=SALE_INVOICE", { cookie: (await call(CLOUD, "POST", "/api/auth/login", { body: { email: "owner@shop.test", password: pw } })).token });
  check("I-08", "The entries made offline survived every close, crash and relaunch and reach the server exactly once",
    !!synced && docs.json?.documents?.length === 2 && pendingRefs.every(Boolean),
    `made offline ${pendingRefs.join(", ")}; now ${synced?.join(", ")}; invoices on the server ${docs.json?.documents?.length}`);
  try { execSync(`taskkill /PID ${a.pid}`, { stdio: "ignore" }); } catch {}
  await exitedWithin(a, 20_000);
} catch (e) {
  check("I-XX", "Scenario completed without an unexpected error", false, String(e?.stack ?? e));
} finally {
  for (const p of apps) stopHard(p.pid);
  stopHard(cloud.pid);
}

await sleep(1500);
// I-09: nothing else was disturbed
const otherAlive = otherNodes.filter(alive);
const otherAnswers = await fetch(`http://127.0.0.1:${otherPort}/`).then((r) => r.text()).catch(() => "");
const ownerAfter = hashTree(ownerData);
const servicesAfter = ps(`@(Get-Service | Where-Object { $_.Name -like '*pakistan*' -or $_.DisplayName -like '*Pakistan*' }).Count`);
const leftovers = apps.flatMap((p) => serversOf(p.pid));
check("I-09", "Unrelated programs and the owner's own desktop data are untouched; no Windows service; no server left running",
  otherAlive.length === otherNodes.length && otherAnswers === "other app" && JSON.stringify(ownerAfter) === JSON.stringify(ownerBefore) && servicesBefore === "0" && servicesAfter === "0" && leftovers.length === 0,
  `other node processes still running ${otherAlive.length}/${otherNodes.length}; other app answers "${otherAnswers}"; owner data files unchanged ${JSON.stringify(ownerAfter) === JSON.stringify(ownerBefore)} (${Object.keys(ownerBefore).length} files); services ${servicesBefore} -> ${servicesAfter}; servers left ${leftovers.length}`);
other.kill();

// I-10: the lock file never blocks: it exists after every run, yet nobody holds it
const lockFile = path.join(dataA, "instance.lock");
let free = false;
try { fs.closeSync(fs.openSync(lockFile, "r+")); free = true; } catch {}
check("I-10", "After the app has ended its lock file is free (Windows released it); no clean-up is ever needed", fs.existsSync(lockFile) && free, `lock file present ${fs.existsSync(lockFile)}; free ${free}`);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync(path.join(here, installed ? "instance-results-installed.json" : "instance-results.json"), JSON.stringify({ at: new Date().toISOString(), exe, passed, total: results.length, results }, null, 2));
fs.rmSync(work, { recursive: true, force: true });
process.exit(passed === results.length ? 0 : 1);
