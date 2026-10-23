// desktop/smoke-test.mjs - Start the built desktop app against a throw-away data folder and check that it brings up
// its local server: health, login page, refusal of a wrong password, a fresh migrated and encrypted-or-not database
// with no users, and that closing the app stops the server. Never touches crm.db or any real data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = process.argv[2] ?? path.join(here, "src-tauri", "target", "release", "pakistan-crm-desktop.exe");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "crm-desktop-smoke-"));
const results = [];
const check = (id, title, pass, evidence) => { results.push({ id, title, pass: !!pass, evidence }); console.log(`${pass ? "PASS" : "FAIL"} ${id} ${title}\n     ${evidence}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, CRM_DESKTOP_DATA_DIR: data, CRM_DESKTOP_NO_DIALOGS: "1" };
if (!process.argv[3]) { env.CRM_DESKTOP_APP_DIR = path.join(here, "bundle", "app"); env.CRM_DESKTOP_NODE = path.join(here, "bundle", "node", "node.exe"); }

const app = spawn(exe, [], { env, stdio: "ignore" });
try {
  const portFile = path.join(data, "logs", "port.txt");
  const started = Date.now();
  while (!fs.existsSync(portFile) && Date.now() - started < 150_000) await sleep(500);
  const port = fs.existsSync(portFile) ? fs.readFileSync(portFile, "utf8").trim() : null;
  const base = `http://127.0.0.1:${port}`;
  const health = port ? await (await fetch(`${base}/api/health`)).json() : null;
  check("W-01", "The desktop app starts its local server (127.0.0.1 only) and opens once it is healthy",
    health?.status === "ok", `port ${port}; health ${JSON.stringify(health)}; started in ${Math.round((Date.now() - started) / 1000)} s`);
  const login = port ? (await fetch(`${base}/login`)).status : 0;
  const wrong = port ? (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }) })).status : 0;
  check("W-02", "The login page is served and a wrong password is refused", login === 200 && wrong === 401, `login page ${login}; wrong password ${wrong}`);
  const cfg = JSON.parse(fs.readFileSync(path.join(data, "desktop.json"), "utf8"));
  const cfgText = fs.readFileSync(path.join(data, "desktop.json"), "utf8");
  check("W-03", "First start creates its own database in the data folder and keeps its secret only DPAPI-protected",
    fs.existsSync(cfg.database) && cfg.protected?.jwtSecret && !/plain/.test(cfgText) && cfg.database.startsWith(data),
    `database ${path.relative(data, cfg.database)}; protected keys ${Object.keys(cfg.protected).join(",")}`);
} catch (e) {
  check("W-XX", "Smoke test completed without an unexpected error", false, String(e?.stack ?? e));
} finally {
  try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch {}
}
await sleep(1500);
// @(...) so one process counts as 1: Windows PowerShell 5.1 gives no .Count for a single object (D-028)
// Only servers started by this test's app count (ParentProcessId), so a Pakistan CRM the owner has open is ignored
const serversOf = (pid) => execSync(`powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.ParentProcessId -eq ${pid} -and $_.CommandLine -like '*app-entry.cjs*' }).Count"`).toString().trim();
const nodeLeft = serversOf(app.pid);
check("W-04", "Closing the app (even forcibly) leaves no server process running", nodeLeft === "0", `server processes left: ${nodeLeft}`);
// The database was brought to this version on first start (CRM_AUTO_MIGRATE)
try {
  const { createClient } = createRequire(path.join(here, "..", "package.json"))("@libsql/client");
  const cfgNow = JSON.parse(fs.readFileSync(path.join(data, "desktop.json"), "utf8"));
  const db = createClient({ url: `file:${cfgNow.database.replace(/\\/g, "/")}` });
  const migs = Number((await db.execute("SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL")).rows[0].n);
  const users = Number((await db.execute("SELECT count(*) AS n FROM users")).rows[0].n);
  db.close();
  const inCode = fs.readdirSync(path.join(here, "..", "prisma", "migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  check("W-05", "The new database has every migration recorded and no users (the first administrator registers)", migs === inCode && users === 0, `migrations ${migs}/${inCode}; users ${users}`);
} catch (e) {
  check("W-05", "The new database has every migration recorded and no users (the first administrator registers)", false, String(e?.message ?? e));
}

// A crash or force-close of the app alone (not its process tree) must still stop the server (Windows job object)
fs.rmSync(path.join(data, "logs", "port.txt"), { force: true });
const again = spawn(exe, [], { env, stdio: "ignore" });
const t0 = Date.now();
while (!fs.existsSync(path.join(data, "logs", "port.txt")) && Date.now() - t0 < 150_000) await sleep(500);
const before = serversOf(again.pid);
try { execSync(`taskkill /PID ${again.pid} /F`, { stdio: "ignore" }); } catch {}
await sleep(2000);
const after = serversOf(again.pid);
check("W-06", "If only the app is killed (as in a crash), its server stops with it", before === "1" && after === "0", `server processes while running ${before}; after killing only the app ${after}`);

// A sale bill can be saved as PDF: the PDF library's fonts ship with the app (fails if they are not traced)
fs.rmSync(path.join(data, "logs", "port.txt"), { force: true });
const third = spawn(exe, [], { env, stdio: "ignore" });
try {
  const t1 = Date.now();
  while (!fs.existsSync(path.join(data, "logs", "port.txt")) && Date.now() - t1 < 150_000) await sleep(500);
  const base = `http://127.0.0.1:${fs.readFileSync(path.join(data, "logs", "port.txt"), "utf8").trim()}`;
  const post = async (p, body, token) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Cookie: `auth-token=${token}` } : {}) }, body: JSON.stringify(body) });
    return { json: await r.json().catch(() => null), token: (r.headers.get("set-cookie") || "").match(/auth-token=([^;]*)/)?.[1] };
  };
  const token = (await post("/api/auth/register", { name: "Smoke", email: "smoke@test.local", password: `Smoke-${Date.now()}-pw` })).token;
  const cat = (await post("/api/categories", { name: "Cups" }, token)).json;
  const item = (await post("/api/inventory", { name: "Cup", categoryId: cat.category.id, quantity: 5, unitCost: 10, unitPrice: 20 }, token)).json;
  const sale = (await post("/api/sales", { walkInName: "Counter", paymentStatus: "PAID", paymentMethod: "CASH", items: [{ componentId: item.component.id, quantity: 2, unitPrice: 20 }] }, token)).json;
  const pdf = await fetch(`${base}/api/sales/${sale.sale.id}/pdf`, { headers: { Cookie: `auth-token=${token}` } });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  check("W-07", "A sale bill downloads as a real PDF from the desktop app", pdf.status === 200 && bytes.subarray(0, 5).toString() === "%PDF-", `${pdf.status} ${pdf.headers.get("content-type")}; ${bytes.length} bytes`);
} catch (e) {
  check("W-07", "A sale bill downloads as a real PDF from the desktop app", false, String(e?.message ?? e));
} finally {
  try { execSync(`taskkill /PID ${third.pid} /T /F`, { stdio: "ignore" }); } catch {}
}
await sleep(1500);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync(path.join(here, "smoke-results.json"), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
fs.rmSync(data, { recursive: true, force: true }); // the throw-away data folder
process.exit(passed === results.length ? 0 : 1);
