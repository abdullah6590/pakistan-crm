// desktop/installer-test.mjs - Windows install / upgrade / uninstall tests (Report 26, desktop U-01..U-06).
// Usage: node installer-test.mjs <old-setup.exe> <new-setup.exe> <test-edition-setup.exe>
//
// Everything is installed into throw-away folders and run against throw-away data folders. Installing writes this
// Windows user's "Pakistan CRM" uninstall entry and shortcuts, which may belong to a copy the owner installed; they
// are exported first and put back at the end (and the result is checked). The owner's installed files and data are
// never touched. The "Delete the application data" case runs on a separately named TEST edition, so even a failure
// could only remove that edition's throw-away data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [oldSetup, newSetup, variantSetup] = process.argv.slice(2).map((p) => path.resolve(p));
if (!oldSetup || !newSetup || !variantSetup) throw new Error("usage: node installer-test.mjs <old-setup> <new-setup> <test-edition-setup>");
// The version being tested is the one in tauri.conf.json
const NEW_VERSION = JSON.parse(fs.readFileSync(path.join(here, "src-tauri", "tauri.conf.json"), "utf8")).version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "crm-installer-test-"));
const results = [];
const check = (id, title, pass, evidence) => { results.push({ id, title, pass: !!pass, evidence }); console.log(`${pass ? "PASS" : "FAIL"} ${id} ${title}\n     ${evidence}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 60_000, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); } return null; };
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const sha = (f) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16) : null);
const run = (exe, args) => execFileSync(exe, args, { stdio: "ignore", timeout: 300_000 });
/** Silent install into `target` only. NSIS ignores a quoted /D= and would then use the remembered folder, which may
 *  be the owner's installation; Node quotes arguments with spaces, so a target with a space is refused outright. */
let ownerInstallGuard = null;
function install(setup, target) {
  if (/\s/.test(target)) throw new Error(`install folder must not contain spaces: ${target}`);
  if (ownerInstallGuard && path.resolve(target).toLowerCase() === path.resolve(ownerInstallGuard).toLowerCase()) throw new Error("refusing to install into the owner's folder");
  run(setup, ["/S", `/D=${target}`]);
  if (!fs.existsSync(path.join(target, "pakistan-crm-desktop.exe"))) throw new Error(`the installer did not install into ${target}; stopping`);
}

const UNINST = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Pakistan CRM";
const MANU = "HKCU\\Software\\pakistancrm";
const regValue = (key, name) => { try { return ps(`(Get-ItemProperty -Path 'Registry::${key}' -ErrorAction Stop).'${name}'`) || null; } catch { return null; } };
const shortcuts = [path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Pakistan CRM.lnk"), path.join(os.homedir(), "Desktop", "Pakistan CRM.lnk")];

// ---- Put aside this user's existing registration (an owner's install), to restore it afterwards ---------------
const saved = { uninst: path.join(work, "uninstall-key.reg"), manu: path.join(work, "manufacturer-key.reg") };
const had = { uninst: regValue(UNINST, "DisplayName") !== null, manu: (() => { try { ps(`Get-Item 'Registry::${MANU}' -ErrorAction Stop | Out-Null`); return true; } catch { return false; } })() };
if (had.uninst) execFileSync("reg", ["export", UNINST, saved.uninst, "/y"], { stdio: "ignore" });
if (had.manu) execFileSync("reg", ["export", MANU, saved.manu, "/y"], { stdio: "ignore" });
const savedLinks = shortcuts.filter((l) => fs.existsSync(l)).map((l) => { const copy = path.join(work, `${crypto.randomUUID()}.lnk`); fs.copyFileSync(l, copy); return { l, copy, hash: sha(l) }; });
const ownerInstall = had.uninst ? regValue(UNINST, "InstallLocation")?.replace(/"/g, "") : null;
ownerInstallGuard = ownerInstall;
const ownerExeHash = ownerInstall ? sha(path.join(ownerInstall, "pakistan-crm-desktop.exe")) : null;
const ownerData = path.join(process.env.APPDATA, "pk.pakistancrm.desktop", "data", "crm.db");
const ownerDataHash = sha(ownerData);

const dir = path.join(work, "PakistanCRM");
const data = path.join(work, "data");
const exe = path.join(dir, "pakistan-crm-desktop.exe");
const env = { ...process.env, CRM_DESKTOP_DATA_DIR: data, CRM_DESKTOP_NO_DIALOGS: "1" };
function launch(file = exe, extraEnv = env) {
  const c = spawn(file, [], { env: extraEnv, stdio: "ignore" });
  c.exited = new Promise((r) => { c.on("exit", (code) => r(code)); c.on("error", () => r("could not start")); });
  return c;
}
async function ready(dataDir = data) {
  const f = path.join(dataDir, "logs", "port.txt");
  try { fs.rmSync(f, { force: true }); } catch {}
  const port = await until(() => fs.existsSync(f) && fs.readFileSync(f, "utf8").trim(), 150_000);
  if (!port) throw new Error("the installed app did not become ready");
  return `http://127.0.0.1:${port}`;
}
async function close(child) {
  try { execSync(`taskkill /PID ${child.pid}`, { stdio: "ignore" }); } catch {}
  const done = await Promise.race([child.exited, sleep(20_000).then(() => "timeout")]);
  if (done === "timeout") try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); } catch {}
}
/** Every style sheet the login page links to, with its HTTP status (all must load: D-036). */
async function loginStyles(base) {
  const html = await (await fetch(`${base}/login`)).text();
  const hrefs = [...new Set([...html.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]))];
  return Promise.all(hrefs.map(async (h) => ({ href: h, status: (await fetch(base + h)).status })));
}
const login = async (base, email, password) => (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).status;

const pw = `Inst-${crypto.randomBytes(4).toString("hex")}-pw`;
const variantData = path.join(process.env.APPDATA, "pk.pakistancrm.uninstalltest");
try {
  // U-01: fresh install of the previous version, used once
  install(oldSetup, dir);
  let app = launch();
  let base = await ready();
  await fetch(`${base}/login`); // the old version saves this page in its program folder (D-036)
  const reg = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Tester", email: "tester@shop.test", password: pw }) });
  await close(app);
  const dbFile = path.join(data, "data", "crm.db");
  const dbAfterOld = sha(dbFile);
  check("U-01", "The previous version (0.1.0) installs for this user and is used (an account is created)",
    fs.existsSync(exe) && regValue(UNINST, "DisplayVersion") === "0.1.0" && [200, 201].includes(reg.status) && !!dbAfterOld,
    `installed ${fs.existsSync(exe)}; version ${regValue(UNINST, "DisplayVersion")}; register ${reg.status}`);

  // U-02: upgrade in place to the new version; the data is kept and the single-instance protection is active
  install(newSetup, dir);
  app = launch();
  base = await ready();
  const loginAfter = await login(base, "tester@shop.test", pw);
  const styles = await loginStyles(base);
  const second = launch();
  const secondExit = await Promise.race([second.exited, sleep(20_000).then(() => "timeout")]);
  const servers = ps(`@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ParentProcessId -in @(${app.pid}, ${second.pid}) -and $_.CommandLine -like '*app-entry.cjs*' }).Count`);
  check("U-02", `Upgrading to ${NEW_VERSION} keeps the account and data, its login page is fully styled, and it refuses a second copy`,
    regValue(UNINST, "DisplayVersion") === NEW_VERSION && loginAfter === 200 && secondExit === 0 && servers === "1" && styles.length > 0 && styles.every((x) => x.status === 200),
    `version ${regValue(UNINST, "DisplayVersion")}; same account signs in ${loginAfter}; second launch exit ${secondExit}; servers ${servers}; login page styles ${styles.map((x) => `${x.href.split("/").pop()} ${x.status}`).join(", ")}`);

  // U-03: installing while the app is open: the installer closes it, then everything still works
  const health = await (await fetch(`${base}/api/health`)).json();
  install(newSetup, dir);
  const closedByInstaller = await Promise.race([app.exited.then(() => true), sleep(30_000).then(() => false)]);
  app = launch();
  base = await ready();
  const loginReinstalled = await login(base, "tester@shop.test", pw);
  await close(app);
  check("U-03", "Installing over a running copy closes it safely; afterwards it starts and the data is intact",
    health.status === "ok" && closedByInstaller && loginReinstalled === 200,
    `running copy closed by the installer ${closedByInstaller}; sign-in afterwards ${loginReinstalled}`);

  // The single-instance and smoke tests, on this installed copy (each uses its own throw-away data folders)
  for (const [id, script, results] of [["U-03a", "instance-test.mjs", "instance-results-installed.json"], ["U-03b", "smoke-test.mjs", "smoke-results.json"]]) {
    let code = 0;
    try { execFileSync(process.execPath, [path.join(here, script), exe, "installed"], { stdio: "ignore", timeout: 900_000 }); } catch (e) { code = e.status ?? 1; }
    const r = JSON.parse(fs.readFileSync(path.join(here, results), "utf8"));
    check(id, `${script} on the installed copy`, code === 0 && r.passed === r.total, `${r.passed}/${r.total} passed${r.results.filter((x) => !x.pass).map((x) => `; FAILED ${x.id}`).join("")}`);
  }

  // U-04: uninstall: the program goes, the data stays, and the next install offers the normal folder
  const dbBeforeUninstall = sha(dbFile);
  // The uninstaller hands over to a temporary copy of itself and returns at once: wait until it has finished
  run(path.join(dir, "uninstall.exe"), ["/S"]);
  const pointsHere = (l) => fs.existsSync(l) && ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${l}').TargetPath`).startsWith(dir);
  await until(() => !fs.existsSync(exe) && regValue(UNINST, "DisplayName") === null && !shortcuts.some(pointsHere) && regValue(`${MANU}\\Pakistan CRM`, "(default)") === null, 60_000, 1000);
  const linksLeft = shortcuts.filter((l) => fs.existsSync(l) && ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${l}').TargetPath`).startsWith(dir));
  check("U-04", "Uninstalling removes the program (nothing left in its folder), its entry and shortcuts, but keeps the business data unchanged",
    !fs.existsSync(exe) && regValue(UNINST, "DisplayName") === null && linksLeft.length === 0 && sha(dbFile) === dbBeforeUninstall && regValue(`${MANU}\\Pakistan CRM`, "(default)") === null && !fs.existsSync(dir),
    `program removed ${!fs.existsSync(exe)}; entry removed ${regValue(UNINST, "DisplayName") === null}; shortcuts left ${linksLeft.length}; database kept unchanged ${sha(dbFile) === dbBeforeUninstall}; remembered folder cleared ${regValue(`${MANU}\\Pakistan CRM`, "(default)") === null}; program folder gone ${!fs.existsSync(dir)}${fs.existsSync(dir) ? ` (left: ${fs.readdirSync(dir, { recursive: true }).slice(0, 5).join(", ")})` : ""}`);

  // U-05: a person ticks "Delete the application data" (TEST edition with its own data folder)
  const vdir = path.join(work, "PakistanCRMUninstallTest");
  install(variantSetup, vdir);
  const vexe = path.join(vdir, "pakistan-crm-desktop.exe");
  const venv = { ...process.env, CRM_DESKTOP_NO_DIALOGS: "1" };
  delete venv.CRM_DESKTOP_DATA_DIR;
  const vapp = launch(vexe, venv);
  await ready(variantData);
  await close(vapp);
  const vdb = path.join(variantData, "data", "crm.db");
  const vhash = sha(vdb);
  // The UI script always prints one JSON line and exits 0
  const ui = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "uninstall-ui.ps1"), path.join(vdir, "uninstall.exe"), "*Uninstall Test*"], { encoding: "utf8", timeout: 300_000 }).trim().split("\n").pop());
  await until(() => !fs.existsSync(vexe), 30_000);
  check("U-05", "Even with 'Delete the application data' ticked, the uninstaller keeps the data and says where it is",
    ui.ticked && !fs.existsSync(vexe) && sha(vdb) === vhash && !!vhash && /does not delete business data/.test(ui.message) && ui.message.includes("pk.pakistancrm.uninstalltest"),
    `box ticked ${ui.ticked}; program removed ${!fs.existsSync(vexe)}; data folder kept with identical database ${sha(vdb) === vhash}; message "${ui.message.replace(/\s+/g, " ").slice(0, 140)}…"; steps ${ui.log.join(" / ")}`);
} catch (e) {
  check("U-XX", "Scenario completed without an unexpected error", false, String(e?.stack ?? e));
} finally {
  // Remove what this test installed, then put back the user's own registration and shortcuts
  for (const d of [dir, path.join(work, "PakistanCRMUninstallTest")]) if (fs.existsSync(path.join(d, "uninstall.exe"))) try { run(path.join(d, "uninstall.exe"), ["/S"]); } catch {}
  try { execFileSync("reg", ["delete", "HKCU\\Software\\pakistancrm\\Pakistan CRM Uninstall Test", "/f"], { stdio: "ignore" }); } catch {}
  try { execFileSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Pakistan CRM Uninstall Test", "/f"], { stdio: "ignore" }); } catch {}
  fs.rmSync(variantData, { recursive: true, force: true }); // the TEST edition's own throw-away data
  if (had.uninst) execFileSync("reg", ["import", saved.uninst], { stdio: "ignore" });
  if (had.manu) execFileSync("reg", ["import", saved.manu], { stdio: "ignore" });
  for (const s of savedLinks) fs.copyFileSync(s.copy, s.l);
}

// U-06: the owner's own installation and data are exactly as before
const restoredLocation = had.uninst ? regValue(UNINST, "InstallLocation")?.replace(/"/g, "") : null;
check("U-06", "The owner's own installation, registration, shortcuts and data are exactly as before",
  restoredLocation === ownerInstall && (ownerInstall ? sha(path.join(ownerInstall, "pakistan-crm-desktop.exe")) === ownerExeHash : true) && sha(ownerData) === ownerDataHash && savedLinks.every((s) => sha(s.l) === s.hash),
  `registration points to the same folder ${restoredLocation === ownerInstall}; installed program unchanged ${ownerInstall ? sha(path.join(ownerInstall, "pakistan-crm-desktop.exe")) === ownerExeHash : "n/a"}; data unchanged ${sha(ownerData) === ownerDataHash}; shortcuts restored ${savedLinks.length}`);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync(path.join(here, "installer-results.json"), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
fs.rmSync(work, { recursive: true, force: true });
process.exit(passed === results.length ? 0 : 1);
