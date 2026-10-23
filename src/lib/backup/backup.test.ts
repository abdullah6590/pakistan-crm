// Phase 6: automatic local encrypted backups (Report 22).
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Each backup derives its key with scrypt twice and verifies a full copy: allow for a loaded machine (D-014)
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import type { PrismaClient } from "@prisma/client";
import { createClient } from "@libsql/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createPurchaseInvoice, createSaleInvoice } from "@/lib/accounting/posting";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations } from "@/lib/tenancy/migrate";
import { ensureAccountingSetup } from "@/lib/accounting/setup";
import { submitCommand } from "@/lib/sync/outbox";
import { createBackup, applyRetention, dueBackups, BackupError, changeMarker } from "./service";
import { openBackup, readManifest } from "./format";

let db: PrismaClient;
let file: string;
let dir: string;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};
const PASS = "correct horse battery staple 42";
let backups: string;

const target = (scope = "server", over: Partial<Parameters<typeof createBackup>[0]> = {}) => ({ db, dbFile: file, tenant: { id: "t_test", name: "Test Traders" }, scope, appVersion: "0.1.0", ...over });

beforeAll(async () => {
  const t = await createTestDb();
  ({ db, file, dir, cleanup } = t);
  backups = path.join(dir, "Backups");
  fs.mkdirSync(backups);
  id.admin = (await db.user.create({ data: { name: "Admin", email: "a@t", password: "x", role: "ADMIN" } })).id;
  const cat = await db.componentCategory.create({ data: { name: "Cups" } });
  id.cups = (await db.component.create({ data: { sku: "C1", name: "Paper cup", categoryId: cat.id } })).id;
  id.customer = (await db.ledgerAccount.create({ data: { code: "CUST", name: "Ali Traders Ltd", kind: "PARTY", subType: "CUSTOMER" } })).id;
  id.supplier = (await db.ledgerAccount.create({ data: { code: "SUPP", name: "Cup Mills", kind: "PARTY", subType: "SUPPLIER" } })).id;
  await createPurchaseInvoice(db, { id: id.admin, role: "ADMIN" }, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.cups, quantity: 1000, unitPrice: 4 }] });
  await createSaleInvoice(db, { id: id.admin, role: "ADMIN" }, { date: "2026-10-02", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 10, unitPrice: 6 }] });
});

afterAll(async () => {
  await cleanup?.();
});

describe("creating and verifying a backup", () => {
  it("produces an encrypted, verified package with a manifest; business data is not readable in the file", async () => {
    const r = await createBackup(target(), { directory: backups, passphrase: PASS, type: "MANUAL", trigger: "USER" });
    const run = await db.backupRun.findUniqueOrThrow({ where: { id: r.backupId } });
    expect([run.status, run.file]).toEqual(["VERIFIED", r.file]);
    expect(r.file.startsWith(path.join(backups, "t_test", "server"))).toBe(true);
    const m = readManifest(r.file);
    expect([m.tenantId, m.scope, m.type, m.counts.accounting_documents, m.dbEncrypted]).toEqual(["t_test", "server", "MANUAL", 2, false]);
    expect(m.schemaVersion).toMatch(/^2026/);
    const raw = fs.readFileSync(r.file);
    expect(raw.includes(Buffer.from("SQLite format 3"))).toBe(false);
    expect(raw.includes(Buffer.from("Ali Traders Ltd"))).toBe(false);
    id.first = r.file;
  });

  it("refuses a wrong passphrase and any altered byte (data or manifest)", async () => {
    const out = path.join(dir, "check.db");
    await expect(openBackup(id.first, out, "wrong passphrase 123")).rejects.toThrow(/Wrong passphrase|altered/);
    const data = Buffer.from(fs.readFileSync(id.first));
    const flipped = Buffer.from(data);
    flipped[flipped.length - 100] ^= 1;
    fs.writeFileSync(path.join(dir, "flipped.pkbk"), flipped);
    await expect(openBackup(path.join(dir, "flipped.pkbk"), out, PASS)).rejects.toThrow(/altered or damaged/);
    const relabelled = Buffer.from(data.toString("latin1").replace("Test Traders", "Evil Traders"), "latin1");
    fs.writeFileSync(path.join(dir, "relabelled.pkbk"), relabelled);
    await expect(openBackup(path.join(dir, "relabelled.pkbk"), out, PASS)).rejects.toThrow(/altered or damaged/);
    const ok = await openBackup(id.first, out, PASS);
    const c = createClient({ url: `file:${out.replace(/\\/g, "/")}` });
    expect(Number((await c.execute("select count(*) n from accounting_documents")).rows[0].n)).toBe(2);
    c.close();
    void ok;
  });

  it("a desktop's encrypted database is restorable on another computer with only the passphrase", async () => {
    const devFile = path.join(dir, "device.db").replace(/\\/g, "/");
    const key = "device-key-".padEnd(40, "z");
    await applyMigrations(`file:${devFile}`, { encryptionKey: key });
    const dev = createPrismaClient(`file:${devFile}`, key);
    await ensureAccountingSetup(dev);
    const u = await dev.user.create({ data: { name: "Clerk", email: "c@t", password: "x", role: "ADMIN" } });
    const cash = await dev.ledgerAccount.create({ data: { code: "CA", name: "Cash", kind: "CASH_BANK", subType: "CASH" } });
    const party = await dev.ledgerAccount.create({ data: { code: "PA", name: "Party", kind: "PARTY", subType: "CUSTOMER" } });
    await submitCommand(dev, { id: "d1", code: "D01" }, { type: "CREATE_DOCUMENT", actorUserId: u.id, docType: "VOUCHER", input: { series: "CRV", date: "2026-10-22", debitAccountId: cash.id, creditAccountId: party.id, amount: 750 } });
    const r = await createBackup({ db: dev, dbFile: devFile, dbKey: key, tenant: { id: "t_test", name: "Test Traders" }, scope: "device-D01", appVersion: "0.1.0" }, { directory: backups, passphrase: PASS, type: "FREQUENT", trigger: "SCHEDULE" });
    expect(readManifest(r.file).counts.pendingSyncEntries).toBe(1); // unsynced entries are in the backup
    expect(readManifest(r.file).dbEncrypted).toBe(true);
    // "Another computer": only the backup file and the passphrase
    const restored = path.join(dir, "restored-device.db");
    const opened = await openBackup(r.file, restored, PASS);
    expect(opened.dbKey).toBe(key);
    const c = createClient({ url: `file:${restored.replace(/\\/g, "/")}`, encryptionKey: opened.dbKey });
    expect(String((await c.execute("select status from outbox_commands")).rows[0].status)).toBe("PENDING_SYNC");
    c.close();
    expect(r.file.includes(path.join("t_test", "device-D01"))).toBe(true); // separate history per computer
    await dev.$disconnect();
  });

  it("stays consistent while entries are being written", async () => {
    let writing = true;
    const writer = (async () => {
      let n = 0;
      while (writing && n < 40) {
        await createSaleInvoice(db, { id: id.admin, role: "ADMIN" }, { date: "2026-10-03", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 1, unitPrice: 6 }] });
        n++;
      }
      return n;
    })();
    const r = await createBackup(target(), { directory: backups, passphrase: PASS, type: "FREQUENT", trigger: "SCHEDULE" });
    writing = false;
    await writer;
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: r.backupId } })).status).toBe("VERIFIED");
  });
});

describe("failures are detected and reported", () => {
  it("insufficient space, an unusable folder and a missing folder fail cleanly with no half-written file", async () => {
    await expect(createBackup(target(), { directory: backups, passphrase: PASS, type: "MANUAL", trigger: "USER", freeSpace: () => 1024 })).rejects.toThrow(/Not enough space/);
    const blocker = path.join(dir, "not-a-folder");
    fs.writeFileSync(blocker, "x");
    await expect(createBackup(target(), { directory: blocker, passphrase: PASS, type: "MANUAL", trigger: "USER" })).rejects.toBeInstanceOf(BackupError);
    await expect(createBackup(target(), { directory: "", passphrase: PASS, type: "MANUAL", trigger: "USER" })).rejects.toThrow(/Choose a backup folder/);
    await expect(createBackup(target(), { directory: backups, passphrase: "short", type: "MANUAL", trigger: "USER" })).rejects.toThrow(/at least 12/);
    const failed = await db.backupRun.findMany({ where: { status: "FAILED" } });
    expect(failed.length).toBe(4);
    expect(failed.every((f) => f.error)).toBe(true);
    const leftovers = fs.readdirSync(path.join(backups, "t_test", "server")).filter((f) => f.endsWith(".partial"));
    expect(leftovers).toEqual([]);
  });
});

describe("retention and scheduling", () => {
  it("keeps the configured number of copies and never removes the newest valid one", async () => {
    for (let i = 0; i < 3; i++) await createBackup(target(), { directory: backups, passphrase: PASS, type: "DAILY", trigger: "SCHEDULE" });
    const removed = await applyRetention(db, { keepDaily: 2, keepFrequent: 0 });
    const left = await db.backupRun.findMany({ where: { status: "VERIFIED" }, orderBy: { startedAt: "desc" } });
    expect(left.filter((r) => r.type === "DAILY").length).toBe(2);
    expect(left[0].type).toBe("DAILY"); // newest survives
    for (const r of await db.backupRun.findMany({ where: { id: { in: removed } } })) expect(fs.existsSync(r.file!)).toBe(false);
    // While Google Drive is connected, a backup still waiting to upload is not pruned
    const waiting = left.find((r) => r.type === "DAILY" && r.id !== left[0].id)!;
    await db.backupRun.update({ where: { id: waiting.id }, data: { uploadStatus: "QUEUED" } });
    await db.driveConnection.create({ data: { id: "local", status: "CONNECTED" } });
    await createBackup(target(), { directory: backups, passphrase: PASS, type: "DAILY", trigger: "SCHEDULE" });
    await applyRetention(db, { keepDaily: 1, keepFrequent: 0 });
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("VERIFIED");
    // Once Drive is disconnected, the normal limit applies again (local copies do not pile up forever)
    await db.driveConnection.update({ where: { id: "local" }, data: { status: "REVOKED" } });
    await applyRetention(db, { keepDaily: 1, keepFrequent: 0 });
    expect((await db.backupRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("DELETED");
  });

  it("daily, missed-at-startup and frequent backups are scheduled from the settings", async () => {
    const s = { enabled: true, dailyTime: "02:00", frequentMinutes: 60 };
    const at = (h: number, m = 0) => { const d = new Date(2026, 9, 22, h, m); return d; };
    expect(dueBackups(at(1, 59), s, { daily: at(2) > at(1) ? new Date(2026, 9, 21, 2) : null }, 10).daily).toBe(false);
    expect(dueBackups(at(2, 5), s, { daily: new Date(2026, 9, 21, 2) }, 10)).toMatchObject({ daily: true, missed: false });
    // The computer was off at 02:00 and is switched on at 09:30: the daily backup runs now, flagged as missed
    expect(dueBackups(at(9, 30), s, { daily: new Date(2026, 9, 21, 2) }, 10)).toMatchObject({ daily: true, missed: true });
    // Frequent backups only when something changed since the last backup
    const done = { daily: at(2, 1), any: at(8), anySeq: 50 };
    expect(dueBackups(at(9, 30), s, done, 50).frequent).toBe(false);
    expect(dueBackups(at(9, 30), s, done, 51).frequent).toBe(true);
    expect(dueBackups(at(9, 30), { ...s, enabled: false }, done, 51)).toEqual({ daily: false, frequent: false, missed: false });
    expect(await changeMarker(db)).toBeGreaterThan(0);
  });
});
