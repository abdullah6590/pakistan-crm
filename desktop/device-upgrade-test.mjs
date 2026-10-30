// desktop/device-upgrade-test.mjs - A syncing desktop upgraded from an older version to the new one, on the real
// installed builds (owner instructions 2026-10-29 and 2026-10-30). Usage: node device-upgrade-test.mjs <old-setup> <new-setup>
// From 0.1.3 (sync protocol 1) the upgraded main server refuses the old desktop until it is upgraded too; from 0.1.4
// (protocol 2) the entries made offline are checked to be still waiting right after the in-place upgrade.
//
// Two throw-away installations of the old version: one runs as the main server ("cloud", started without the window),
// the other is the desktop app working as a syncing device. The device works offline, both are upgraded, and its
// entries must sync exactly once, also when the app is killed in the middle of a sync. Like installer-test.mjs, this
// user's own "Pakistan CRM" registration and shortcuts are exported first and put back at the end; the owner's
// installed program and data are never touched and are checked at the end.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const [oldSetup, newSetup] = process.argv.slice(2).map((p) => path.resolve(p));
if (!oldSetup || !newSetup) throw new Error("usage: node device-upgrade-test.mjs <old-setup> <new-setup>");
const NEW_VERSION = JSON.parse(fs.readFileSync(path.join(here, "src-tauri", "tauri.conf.json"), "utf8")).version;
const OLD_VERSION = path.basename(oldSetup).match(/_(\d+\.\d+\.\d+)_/)?.[1];
if (!OLD_VERSION) throw new Error(`cannot read the old version from the installer name: ${path.basename(oldSetup)}`);
const OLD_PROTOCOL_1 = OLD_VERSION === "0.1.3" || OLD_VERSION.startsWith("0.1.0") || OLD_VERSION === "0.1.1" || OLD_VERSION === "0.1.2";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "crm-device-upgrade-"));
const results = [];
const check = (id, title, pass, evidence) => { results.push({ id, title, pass: !!pass, evidence }); console.log(`${pass ? "PASS" : "FAIL"} ${id} ${title}\n     ${evidence}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 60_000, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); } return null; };
const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const sha = (f) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16) : null);
const run = (exe, args) => execFileSync(exe, args, { stdio: "ignore", timeout: 300_000 });
const rid = () => crypto.randomUUID();

// ---- The owner's registration, shortcuts, program and data: put aside and checked afterwards (as installer-test) ----
const UNINST = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Pakistan CRM";
const MANU = "HKCU\\Software\\pakistancrm";
const regValue = (key, name) => { try { return ps(`(Get-ItemProperty -Path 'Registry::${key}' -ErrorAction Stop).'${name}'`) || null; } catch { return null; } };
const shortcuts = [path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Pakistan CRM.lnk"), path.join(os.homedir(), "Desktop", "Pakistan CRM.lnk")];
// Kept outside the throw-away folder: deleted only after the owner's registration is back and checked (D-09)
const keep = fs.mkdtempSync(path.join(os.tmpdir(), "crm-owner-registration-"));
const saved = { uninst: path.join(keep, "uninstall-key.reg"), manu: path.join(keep, "manufacturer-key.reg") };
const had = { uninst: regValue(UNINST, "DisplayName") !== null, manu: (() => { try { ps(`Get-Item 'Registry::${MANU}' -ErrorAction Stop | Out-Null`); return true; } catch { return false; } })() };
if (had.uninst) execFileSync("reg", ["export", UNINST, saved.uninst, "/y"], { stdio: "ignore" });
if (had.manu) execFileSync("reg", ["export", MANU, saved.manu, "/y"], { stdio: "ignore" });
const savedLinks = shortcuts.filter((l) => fs.existsSync(l)).map((l) => { const copy = path.join(keep, `${crypto.randomUUID()}.lnk`); fs.copyFileSync(l, copy); return { l, copy, hash: sha(l) }; });
const ownerInstall = had.uninst ? regValue(UNINST, "InstallLocation")?.replace(/"/g, "") : null;
const ownerExeHash = ownerInstall ? sha(path.join(ownerInstall, "pakistan-crm-desktop.exe")) : null;
const ownerData = path.join(process.env.APPDATA, "pk.pakistancrm.desktop", "data", "crm.db");
const ownerDataHash = sha(ownerData);

function install(setup, target) {
  if (/\s/.test(target)) throw new Error(`install folder must not contain spaces: ${target}`);
  if (ownerInstall && path.resolve(target).toLowerCase() === path.resolve(ownerInstall).toLowerCase()) throw new Error("refusing to install into the owner's folder");
  run(setup, ["/S", `/D=${target}`]);
  if (!fs.existsSync(path.join(target, "pakistan-crm-desktop.exe"))) throw new Error(`the installer did not install into ${target}`);
}

// ---- The main server: the installed program's own server, started without the window, on a fixed port ---------
const cloudDir = path.join(work, "Cloud");
const cloudData = path.join(work, "cloud-data");
const CLOUD_PORT = 3961;
const CLOUD = `http://127.0.0.1:${CLOUD_PORT}`;
let cloud = null;
async function startCloud() {
  fs.mkdirSync(path.join(cloudData, "logs"), { recursive: true });
  const log = fs.openSync(path.join(cloudData, "logs", "cloud.log"), "a");
  cloud = spawn(path.join(cloudDir, "node", "node.exe"), [path.join(cloudDir, "app", "app-entry.cjs")], {
    cwd: path.join(cloudDir, "app"), stdio: ["ignore", log, log], windowsHide: true,
    env: { ...process.env, CRM_DESKTOP_DATA: cloudData, PORT: String(CLOUD_PORT), HOSTNAME: "127.0.0.1" },
  });
  cloud.exited = new Promise((r) => cloud.on("exit", r));
  if (!(await until(async () => (await fetch(`${CLOUD}/login`)).status === 200, 150_000))) throw new Error("the main server did not start");
}
async function stopCloud() {
  if (!cloud) return;
  try { execFileSync("taskkill", ["/PID", String(cloud.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  await Promise.race([cloud.exited, sleep(15_000)]);
  cloud = null;
}

// ---- The device: the desktop app itself (window and server), with its own data folder ---------------------------
const devDir = path.join(work, "Device");
const devData = path.join(work, "device-data");
let device = null;
async function startDevice() {
  const f = path.join(devData, "logs", "port.txt");
  try { fs.rmSync(f, { force: true }); } catch {}
  device = spawn(path.join(devDir, "pakistan-crm-desktop.exe"), [], { stdio: "ignore", env: { ...process.env, ...WEBVIEW_DEBUG, CRM_DESKTOP_DATA_DIR: devData, CRM_DESKTOP_NO_DIALOGS: "1", CRM_SYNC_INTERVAL_MS: "3000" } });
  device.exited = new Promise((r) => { device.on("exit", r); device.on("error", () => r("could not start")); });
  const port = await until(async () => fs.existsSync(f) && fs.readFileSync(f, "utf8").trim(), 180_000);
  if (!port) throw new Error("the desktop app did not become ready");
  return `http://127.0.0.1:${port}`;
}
async function stopDevice(force = false) {
  if (!device) return;
  try { execFileSync("taskkill", ["/PID", String(device.pid), ...(force ? ["/T", "/F"] : [])], { stdio: "ignore" }); } catch {}
  const done = await Promise.race([device.exited, sleep(20_000).then(() => "timeout")]);
  if (done === "timeout") try { execFileSync("taskkill", ["/PID", String(device.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  // The server is a child of the window process; make sure nothing is left holding the data folder
  await sleep(1500);
  device = null;
}

// ---- The window itself: WebView2's debugging protocol, to see what the page really does under its security policy ---
const WEBVIEW_PORT = 9343;
const WEBVIEW_DEBUG = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${WEBVIEW_PORT}` };
async function webview(match) {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${WEBVIEW_PORT}/json/list`)).json()).find((t) => t.type === "page" && match(t.url)), 60_000, 1000);
  if (!target) return null;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) pending.get(d.id)?.(d); else events.push(d); };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++next; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { send, evaluate, events, url: target.url, close: () => ws.close() };
}
/** Messages the page logged about blocked content (Content Security Policy) or script errors. */
const blocked = (events) => events.filter((e) => (e.method === "Log.entryAdded" && /content security policy|refused to/i.test(e.params.entry.text))
  || e.method === "Runtime.exceptionThrown").map((e) => e.params.entry?.text ?? e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text);

async function call(base, method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `auth-token=${cookie}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const m = (res.headers.get("set-cookie") || "").match(/auth-token=([^;]*)/);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, token: m ? m[1] : null };
}
const loginAs = async (base, email, password) => (await call(base, "POST", "/api/auth/login", { body: { email, password } })).token;
const outbox = async (base, cookie) => (await call(base, "GET", "/api/sync/outbox", { cookie })).json?.entries ?? [];
const syncNow = (base, cookie) => call(base, "POST", "/api/sync/status", { cookie });

const pw = `Dev-${crypto.randomBytes(4).toString("hex")}-pw`;
const EMAIL = "owner@shop.test";
try {
  // D-01 the old version: a main server and a syncing desktop; the desktop downloads its copy
  install(oldSetup, cloudDir);
  install(oldSetup, devDir);
  await startCloud();
  const A = (await call(CLOUD, "POST", "/api/auth/register", { body: { name: "Owner", email: EMAIL, password: pw } })).token;
  const cat = (await call(CLOUD, "POST", "/api/categories", { cookie: A, body: { name: "Board" } })).json.category;
  const item = (await call(CLOUD, "POST", "/api/inventory", { cookie: A, body: { name: "TEST board", categoryId: cat.id, quantity: 0, unitCost: 0, unitPrice: 100 } })).json.component;
  const acct = async (name, kind, subType) => (await call(CLOUD, "POST", "/api/accounting/accounts", { cookie: A, body: { name, kind, subType } })).json.account;
  const custAcc = await acct("Walk-in trader", "PARTY", "CUSTOMER");
  const supAcc = await acct("Old mill", "PARTY", "SUPPLIER");
  const cash = await acct("Shop cash", "CASH_BANK", "CASH");
  const pi = await call(CLOUD, "POST", "/api/accounting/documents", { cookie: A, body: { type: "PURCHASE_INVOICE", date: "2026-10-20", partyAccountId: supAcc.id, lines: [{ componentId: item.id, quantity: 1000, unitPrice: 50 }] } });
  const reg = await call(CLOUD, "POST", "/api/sync/devices", { cookie: A, body: { name: "Shop desktop", role: "DEVICE" } });
  fs.mkdirSync(devData, { recursive: true });
  fs.writeFileSync(path.join(devData, "desktop.json"), JSON.stringify({ role: "device", upstreamUrl: CLOUD, deviceId: reg.json.device.id, deviceCode: reg.json.device.code, tenantId: reg.json.tenantId, plain: { deviceSecret: reg.json.secret } }, null, 2));
  let D = await startDevice();
  let dc = await until(() => loginAs(D, EMAIL, pw), 120_000, 2000); // the user arrives with the first download
  const stockOnDevice = await until(async () => {
    const r = await call(D, "GET", "/api/accounting/reports?report=stock", { cookie: dc });
    return r.json?.rows?.find((x) => x.componentId === item.id && Number(x.onHand) === 1000) ? 1000 : null;
  }, 60_000, 2000);
  const cfg = JSON.parse(fs.readFileSync(path.join(devData, "desktop.json"), "utf8"));
  check("D-01", `${OLD_VERSION}: a main server and a syncing desktop; the desktop downloads its copy (users, stock) and keeps its secret protected`,
    pi.status === 201 && reg.status === 201 && !!dc && stockOnDevice === 1000 && !cfg.plain && !!cfg.protected?.deviceSecret && !!cfg.protected?.dbKey,
    `purchase ${pi.status}; device ${reg.json?.device?.code}; owner signs in on the desktop ${!!dc}; stock there ${stockOnDevice}; secret protected ${!!cfg.protected?.deviceSecret}, database key ${!!cfg.protected?.dbKey}`);

  // D-02 offline on the old version: a sale invoice and a cash receipt wait on the desktop, also across a restart
  await stopCloud();
  const sale = await call(D, "POST", "/api/accounting/documents", { cookie: dc, body: { type: "SALE_INVOICE", date: "2026-10-28", partyAccountId: custAcc.id, lines: [{ componentId: item.id, quantity: 10, unitPrice: 100 }] } });
  const rcpt = await call(D, "POST", "/api/accounting/documents", { cookie: dc, body: { type: "VOUCHER", series: "CRV", date: "2026-10-28", debitAccountId: cash.id, creditAccountId: custAcc.id, amount: "400", remarks: "Part payment" } });
  await stopDevice();
  D = await startDevice();
  dc = await loginAs(D, EMAIL, pw);
  const waiting013 = (await outbox(D, dc)).filter((e) => e.status !== "SYNCED");
  const ids013 = waiting013.map((e) => e.id);
  check("D-02", `${OLD_VERSION} offline: a sale invoice and a receipt are kept on the desktop, still waiting after closing and reopening`,
    sale.status === 201 && rcpt.status === 201 && waiting013.length === 2,
    `sale ${sale.status} ${sale.json?.entry?.provisionalRef}; receipt ${rcpt.status} ${rcpt.json?.entry?.provisionalRef}; waiting after restart ${waiting013.map((e) => `${e.provisionalRef}:${e.status}`).join(", ")}`);

  // D-03 the main server is upgraded first: it updates its database, and refuses the old desktop without losing its entries
  await stopDevice();
  install(newSetup, cloudDir);
  await startCloud();
  const A2 = await loginAs(CLOUD, EMAIL, pw);
  const cloudHealth = (await call(CLOUD, "GET", "/api/health")).json;
  const cloudStock = (await call(CLOUD, "GET", "/api/accounting/reports?report=stock", { cookie: A2 })).json?.rows?.find((x) => x.componentId === item.id)?.onHand;
  if (OLD_PROTOCOL_1) {
    D = await startDevice();
    dc = await loginAs(D, EMAIL, pw);
    const refused = await syncNow(D, dc);
    const stillWaiting = (await outbox(D, dc)).filter((e) => e.status !== "SYNCED");
    const refusedMsg = JSON.stringify(refused.json ?? {});
    check("D-03", `The main server on ${NEW_VERSION} keeps its data; it refuses the ${OLD_VERSION} desktop ("update"), whose entries keep waiting`,
      !!A2 && cloudHealth?.status === "ok" && /update/i.test(refusedMsg) && stillWaiting.length === 2,
      `owner signs in on the upgraded server ${!!A2}; health ${cloudHealth?.status}; sync answer ${refusedMsg.slice(0, 160)}; still waiting ${stillWaiting.length}`);
  } else {
    check("D-03", `The main server upgraded in place to ${NEW_VERSION} keeps its data, accounts and stock; the owner signs in again`,
      !!A2 && cloudHealth?.status === "ok" && Number(cloudStock) === 1000,
      `owner signs in on the upgraded server ${!!A2}; health ${cloudHealth?.status}; stock there ${cloudStock}`);
  }

  // D-04 the desktop is upgraded in place ("do not uninstall"): data, accounts and waiting entries kept, then synced once
  await stopDevice();
  const oldToken = dc;
  const devDb = path.join(devData, "data", "crm.db");
  // From 0.1.4 the server is offline during the upgrade, so the entries can be seen still waiting before they sync
  if (!OLD_PROTOCOL_1) await stopCloud();
  install(newSetup, devDir);
  D = await startDevice();
  const oldTokenAnswer = (await call(D, "GET", "/api/auth/sessions", { cookie: oldToken })).status;
  dc = await loginAs(D, EMAIL, pw);
  const waitingRightAfter = (await outbox(D, dc)).filter((e) => ids013.includes(e.id) && e.status !== "SYNCED").length;
  if (!OLD_PROTOCOL_1) await startCloud();
  // The upgraded desktop may send them the moment it starts: what counts is that the same entries are still there
  const keptAfterUpgrade = (await outbox(D, dc)).filter((e) => ids013.includes(e.id)).length;
  await syncNow(D, dc);
  const synced = await until(async () => {
    const all = (await outbox(D, dc)).filter((e) => ids013.includes(e.id));
    return all.length === 2 && all.every((e) => e.status === "SYNCED") ? all : null;
  }, 90_000, 2000);
  const officials = (synced ?? []).map((e) => JSON.parse(e.result ?? "{}").docNo).sort();
  check("D-04", `The desktop upgraded in place to ${NEW_VERSION}: same account (old sign-in refused, sign in again), its 2 waiting entries kept and then posted once with official numbers`,
    !!dc && oldTokenAnswer === 401 && keptAfterUpgrade === 2 && (OLD_PROTOCOL_1 || waitingRightAfter === 2) && officials.join() === "CRV-0001,SI-0001" && fs.existsSync(devDb),
    `old ${OLD_VERSION} sign-in ${oldTokenAnswer}; signs in again ${!!dc}; still waiting right after the upgrade ${OLD_PROTOCOL_1 ? "n/a" : waitingRightAfter}; the 2 entries from ${OLD_VERSION} on the desktop ${keptAfterUpgrade}; official numbers ${officials.join(", ")}`);

  // D-05 the new screens: a supplier, a customer, an unpaid purchase bill and an unpaid sale on the server reach the desktop
  const A3 = await loginAs(CLOUD, EMAIL, pw);
  const sup = (await call(CLOUD, "POST", "/api/suppliers", { cookie: A3, body: { name: "TEST Mill", phone: "0300-1112223" } })).json.supplier;
  const cust = (await call(CLOUD, "POST", "/api/customers", { cookie: A3, body: { name: "TEST Customer", phone: "0300-4445556" } })).json.customer;
  const cloudBill = (await call(CLOUD, "POST", "/api/purchases", { cookie: A3, body: { date: "2026-10-28", supplierId: sup.id, items: [{ componentId: item.id, quantity: 100, unitPrice: "50.25" }], requestId: rid() } })).json.purchase;
  const cloudSale = (await call(CLOUD, "POST", "/api/sales", { cookie: A3, body: { date: "2026-10-28", customerId: cust.id, items: [{ componentId: item.id, quantity: 20, unitPrice: 100 }], paidNow: { amount: "0", method: "CASH" }, requestId: rid() } })).json.sale;
  await syncNow(D, dc);
  const arrived = await until(async () => {
    const s = await call(D, "GET", `/api/purchases/payments?supplierId=${sup.id}`, { cookie: dc });
    return s.json?.account?.bills?.some((b) => b.id === cloudBill.id) ? s : null;
  }, 60_000, 2000);
  check("D-05", "Suppliers, customers, purchase bills and sales made on the server arrive on the desktop",
    !!cloudBill && !!cloudSale && !!arrived, `bill ${cloudBill?.docNo} and sale ${cloudSale?.docNo} on the server; the desktop shows the supplier's open bill ${!!arrived}`);

  // D-06 offline on the new version: a sale with part paid now, a customer payment, a purchase with part paid now and a
  // supplier payment; each clicked twice
  await stopCloud();
  const twice = async (p, body) => { const one = await call(D, "POST", p, { cookie: dc, body }); const two = await call(D, "POST", p, { cookie: dc, body }); return [one, two]; };
  const [s1, s2] = await twice("/api/sales", { date: "2026-10-29", customerId: cust.id, items: [{ componentId: item.id, quantity: 5, unitPrice: 100 }], paidNow: { amount: "200", method: "CASH" }, requestId: rid() });
  const [r1, r2] = await twice("/api/sales/payments", { customerId: cust.id, date: "2026-10-29", amount: "1500", method: "CASH", allocations: [{ invoiceId: cloudSale.id, amount: "1500" }], requestId: rid() });
  const [p1, p2] = await twice("/api/purchases", { date: "2026-10-29", supplierId: sup.id, vendorBillNo: "TM-9", items: [{ componentId: item.id, quantity: 40, unitPrice: "50.25" }], paidNow: { amount: "1000", method: "CASH" }, requestId: rid() });
  const [q1, q2] = await twice("/api/purchases/payments", { supplierId: sup.id, date: "2026-10-29", amount: "2000", method: "BANK_TRANSFER", reference: "TT-77", allocations: [{ billId: cloudBill.id, amount: "2000" }], requestId: rid() });
  const queued = [s1, r1, p1, q1];
  const repeats = [s2, r2, p2, q2];
  const waitingNew = (await outbox(D, dc)).filter((e) => e.status !== "SYNCED");
  check("D-06", "Offline on the new version: a sale, a customer payment, a purchase and a supplier payment are queued once each (second clicks answered with the first)",
    queued.every((x) => x.status === 201 && x.json?.pending) && repeats.every((x) => x.status === 200 && x.json?.repeated) && waitingNew.length === 4,
    `queued ${queued.map((x) => `${x.status} ${x.json?.entry?.provisionalRef ?? x.json?.error}`).join(", ")}; repeats ${repeats.map((x) => x.status).join(", ")}; waiting ${waitingNew.length}`);
  const ids = queued.map((x) => x.json.entry.id);

  // D-07 back online, the app is killed in the middle of the sync; after it is reopened everything is posted exactly once
  await startCloud();
  const cloudDb = path.join(cloudData, "data", "crm.db");
  void syncNow(D, dc).catch(() => null);
  const firstIn = await until(async () => {
    const c = createClient({ url: `file:${cloudDb.replace(/\\/g, "/")}` });
    try { return Number((await c.execute({ sql: `SELECT COUNT(*) n FROM sync_inbox WHERE commandId IN (${ids.map(() => "?").join(",")})`, args: ids })).rows[0].n) > 0; } finally { c.close(); }
  }, 60_000, 100);
  await stopDevice(true);
  D = await startDevice();
  dc = await loginAs(D, EMAIL, pw);
  await syncNow(D, dc);
  const allSynced = await until(async () => {
    const all = (await outbox(D, dc)).filter((e) => ids.includes(e.id));
    return all.length === 4 && all.every((e) => e.status === "SYNCED") ? all : null;
  }, 120_000, 2000);
  const tbDev = (await call(D, "GET", "/api/accounting/reports?report=trial-balance", { cookie: dc })).json;
  const tbCloud = (await call(CLOUD, "GET", "/api/accounting/reports?report=trial-balance", { cookie: await loginAs(CLOUD, EMAIL, pw) })).json;
  const c = createClient({ url: `file:${cloudDb.replace(/\\/g, "/")}` });
  const one = async (sql, args) => Number((await c.execute({ sql, args })).rows[0].n);
  const docs = await one(`SELECT COUNT(*) n FROM accounting_documents WHERE commandId IN (${[...ids, `${ids[0]}:paid`, `${ids[2]}:paid`].map(() => "?").join(",")})`, [...ids, `${ids[0]}:paid`, `${ids[2]}:paid`]);
  const inbox = await one(`SELECT COUNT(*) n FROM sync_inbox WHERE commandId IN (${ids.map(() => "?").join(",")})`, ids);
  const paidOn = async (docId) => (await c.execute({ sql: "SELECT COALESCE(SUM(CAST(amount AS REAL)),0) s FROM payment_allocations WHERE debitDocId = ? AND releasedAt IS NULL", args: [docId] })).rows[0].s;
  const offlineBill = (await c.execute({ sql: "SELECT id, total FROM accounting_documents WHERE commandId = ?", args: [ids[2]] })).rows[0];
  const facts = { cloudBillPaid: await paidOn(cloudBill.id), cloudSalePaid: await paidOn(cloudSale.id), offlineBillTotal: offlineBill?.total, offlineBillPaid: offlineBill ? await paidOn(offlineBill.id) : null };
  c.close();
  check("D-07", "Killed during the sync and reopened: all 4 entries posted exactly once (6 documents incl. the two paid-now payments), payments land on the right bills, desktop and server agree",
    firstIn && !!allSynced && docs === 6 && inbox === 4 && facts.cloudBillPaid === 2000 && facts.cloudSalePaid === 1500 && facts.offlineBillTotal === "2010" && facts.offlineBillPaid === 1000
      && tbDev?.balanced && tbCloud?.balanced && tbDev?.debitTotal === tbCloud?.debitTotal,
    `server had started receiving when the app was killed ${!!firstIn}; all synced ${!!allSynced}; documents ${docs}, received entries ${inbox}; ${JSON.stringify(facts)}; trial balance desktop ${tbDev?.debitTotal} / server ${tbCloud?.debitTotal}`);

  // D-08 backup and restore check on the upgraded desktop
  fs.mkdirSync(path.join(work, "device-backups"), { recursive: true });
  const settings = await call(D, "PUT", "/api/backups/settings", { cookie: dc, body: { directory: path.join(work, "device-backups"), passphrase: "test-passphrase-123456", passphraseConfirm: "test-passphrase-123456" } });
  const backup = await call(D, "POST", "/api/backups", { cookie: dc });
  const plan = backup.json?.backupId && await call(D, "POST", "/api/backups/restore", { cookie: dc, body: { action: "prepare", backupId: backup.json.backupId, passphrase: "test-passphrase-123456" } });
  const checks = plan?.json?.plan?.checks;
  if (plan?.json?.plan?.recoveryId) await call(D, "POST", "/api/backups/restore", { cookie: dc, body: { action: "discard", recoveryId: plan.json.plan.recoveryId } });
  check("D-08", "On the upgraded desktop a backup is made and verified, and a restore check of it passes (integrity, record counts); nothing is replaced",
    settings.status === 200 && backup.status === 201 && checks?.integrity === "ok" && checks?.countsMatch === true,
    `settings ${settings.status} ${settings.json?.error ?? ""}; backup ${backup.status} ${backup.json?.error ?? path.basename(backup.json?.file ?? "")}; restore check ${JSON.stringify(checks ?? plan?.json ?? {}).slice(0, 160)}`);

  // D-10 the real window under the security policy: the login page runs its scripts (nothing blocked) and the owner
  // signs in through the form, reaching the dashboard
  const win = await webview((u) => u.startsWith(D));
  let ui = { found: !!win };
  if (win) {
    await win.send("Log.enable");
    await win.send("Runtime.enable");
    await win.send("Page.enable");
    await win.send("Page.navigate", { url: `${D}/login` });
    ui.hydrated = await until(async () => (await win.evaluate("typeof window.next?.version === 'string' && !!document.querySelector('input[type=email]')")) || null, 30_000, 500);
    await win.evaluate(`(() => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(document.querySelector("input[type=email]"), ${JSON.stringify(EMAIL)});
      set(document.querySelector("input[type=password]"), ${JSON.stringify(pw)});
      document.querySelector("button[type=submit]").click();
    })()`);
    ui.dashboard = await until(async () => (await win.evaluate("location.pathname")).startsWith("/dashboard") || null, 45_000, 500);
    await sleep(3000);
    ui.blocked = blocked(win.events);
    win.close();
  }
  check("D-10", "In the desktop window the login page runs under its security policy with nothing blocked, and signing in through the form reaches the dashboard",
    ui.found && ui.hydrated && ui.dashboard && ui.blocked.length === 0,
    `window found ${ui.found}; page scripts running ${!!ui.hydrated}; dashboard reached ${!!ui.dashboard}; blocked or failed: ${ui.blocked?.length ? ui.blocked.join(" | ").slice(0, 300) : "none"}`);

  // D-11 sign-in, sessions and the page security policy on the installed desktop (Phase 0). Last, because the wrong
  // passwords below block this account for new browsers for 15 minutes.
  const raw = async (method, p, cookies, body) => {
    const res = await fetch(D + p, { method, headers: { "Content-Type": "application/json", Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    const set = Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(";")[0]).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json, set, headers: res.headers };
  };
  const usual = (await raw("POST", "/api/auth/login", {}, { email: EMAIL, password: pw })).set;
  const second = (await raw("POST", "/api/auth/login", {}, { email: EMAIL, password: pw })).set;
  const kdName = Object.keys(usual).find((k) => k.startsWith("crm-kd-"));
  const secondId = (await raw("GET", "/api/auth/sessions", { "auth-token": second["auth-token"] })).json?.sessions?.find((x) => x.current)?.id;
  const revoked = await raw("DELETE", "/api/auth/sessions", { "auth-token": usual["auth-token"] }, { sessionId: secondId });
  const secondAfter = (await raw("GET", "/api/auth/sessions", { "auth-token": second["auth-token"] })).status;
  const usualAfter = (await raw("GET", "/api/auth/sessions", { "auth-token": usual["auth-token"] })).status;
  await raw("POST", "/api/auth/logout", { "auth-token": usual["auth-token"] });
  const afterLogout = (await raw("GET", "/api/auth/sessions", { "auth-token": usual["auth-token"] })).status;
  const wrong = [];
  for (let i = 0; i < 10; i++) wrong.push((await raw("POST", "/api/auth/login", {}, { email: EMAIL, password: `wrong-${i}` })).status);
  const stranger = (await raw("POST", "/api/auth/login", {}, { email: EMAIL, password: pw })).status;
  const recognised = (await raw("POST", "/api/auth/login", { [kdName]: usual[kdName] }, { email: EMAIL, password: pw })).status;
  const page = await fetch(D + "/login");
  const csp = page.headers.get("content-security-policy") ?? "";
  const html = await page.text();
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  check("D-11", "Installed desktop: revoking a session and logging out take effect at once; wrong passwords block new browsers but not the recognised one; pages carry the nonce security policy",
    revoked.status === 200 && secondAfter === 401 && usualAfter === 200 && afterLogout === 401 && wrong.every((x) => x === 401) && stranger === 429 && recognised === 200
      && !!nonce && /script-src[^;]*'strict-dynamic'|script-src[^;]*'nonce-/.test(csp) && scripts.length > 0 && scripts.every((t) => t.includes(`nonce="${nonce}"`)),
    `revoke ${revoked.status}; revoked browser ${secondAfter}; this browser ${usualAfter}; after logout ${afterLogout}; wrong passwords ${[...new Set(wrong)].join(",")}; then a new browser ${stranger}, the recognised browser ${recognised}; policy nonce ${!!nonce}, ${scripts.filter((t) => t.includes(`nonce="${nonce}"`)).length}/${scripts.length} scripts carry it`);

  // D-12 when the local server cannot start, the loading page (bundled, with its own security policy) shows the problem
  await stopDevice();
  const failData = path.join(work, "fail-data");
  fs.mkdirSync(failData, { recursive: true });
  const failing = spawn(path.join(devDir, "pakistan-crm-desktop.exe"), [], { stdio: "ignore", env: { ...process.env, ...WEBVIEW_DEBUG, CRM_DESKTOP_DATA_DIR: failData, CRM_DESKTOP_NO_DIALOGS: "1", CRM_DESKTOP_NODE: path.join(work, "no-such-node.exe") } });
  const loading = await webview((u) => !u.startsWith("http://127.0.0.1"));
  let shown = {};
  if (loading) {
    await loading.send("Log.enable");
    shown.script = await loading.evaluate("typeof window.showProblem");
    shown.text = await until(async () => (await loading.evaluate("getComputedStyle(document.getElementById('problem')).display !== 'none' && document.getElementById('problem').textContent")) || null, 30_000, 500);
    shown.status = await loading.evaluate("document.getElementById('status').textContent");
    shown.url = loading.url;
    loading.close();
  }
  try { execFileSync("taskkill", ["/PID", String(failing.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  await sleep(1500);
  check("D-12", "If the local server cannot start, the window's loading page runs its script under its security policy and shows what went wrong",
    !!loading && shown.script === "function" && !!shown.text && /could not start/i.test(shown.status ?? ""),
    `loading page ${shown.url ?? "not found"}; its script ${shown.script}; status "${shown.status}"; message "${String(shown.text ?? "").slice(0, 120)}"`);
} catch (e) {
  check("D-XX", "Scenario completed without an unexpected error", false, String(e?.stack ?? e));
} finally {
  await stopDevice(true).catch(() => {});
  await stopCloud().catch(() => {});
  for (const d of [devDir, cloudDir]) {
    if (!fs.existsSync(path.join(d, "uninstall.exe"))) continue;
    try { run(path.join(d, "uninstall.exe"), ["/S"]); } catch {}
    await until(async () => !fs.existsSync(path.join(d, "pakistan-crm-desktop.exe")), 120_000, 1000);
  }
  await sleep(10_000); // the uninstaller's own clean-up of its registration runs last
  const restore = () => {
    if (had.uninst) execFileSync("reg", ["import", saved.uninst], { stdio: "ignore" });
    else try { execFileSync("reg", ["delete", UNINST, "/f"], { stdio: "ignore" }); } catch {}
    if (had.manu) execFileSync("reg", ["import", saved.manu], { stdio: "ignore" });
    for (const s of savedLinks) fs.copyFileSync(s.copy, s.l);
  };
  restore();
  // Checked again a little later, in case a late uninstaller step removed it after all
  await sleep(10_000);
  if (had.uninst && regValue(UNINST, "InstallLocation")?.replace(/"/g, "") !== ownerInstall) restore();
}

const restoredLocation = had.uninst ? regValue(UNINST, "InstallLocation")?.replace(/"/g, "") : null;
check("D-09", "The owner's own installation, registration, shortcuts and data are exactly as before",
  restoredLocation === ownerInstall && (ownerInstall ? sha(path.join(ownerInstall, "pakistan-crm-desktop.exe")) === ownerExeHash : true) && sha(ownerData) === ownerDataHash && savedLinks.every((s) => sha(s.l) === s.hash),
  `registration points to the same folder ${restoredLocation === ownerInstall}; installed program unchanged ${ownerInstall ? sha(path.join(ownerInstall, "pakistan-crm-desktop.exe")) === ownerExeHash : "n/a"}; data unchanged ${sha(ownerData) === ownerDataHash}; shortcuts restored ${savedLinks.length}`);

if (results.find((r) => r.id === "D-09")?.pass) fs.rmSync(keep, { recursive: true, force: true });
else console.log(`The owner's registration export is kept in ${keep}; restore it with: reg import "${saved.uninst}"`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync(path.join(here, "device-upgrade-results.json"), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* Windows may still hold a file; the temp folder is cleared later */ }
process.exit(passed === results.length ? 0 : 1);
