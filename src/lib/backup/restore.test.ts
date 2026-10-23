// Phase 8: restore and disaster recovery (Report 23).
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Each scenario derives scrypt keys and verifies full copies: allow for a loaded machine (D-014)
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
import type { PrismaClient } from "@prisma/client";
import { createClient } from "@libsql/client";
import { createPurchaseInvoice, createSaleInvoice } from "@/lib/accounting/posting";
import { ensureAccountingSetup } from "@/lib/accounting/setup";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations, MIGRATIONS_DIR } from "@/lib/tenancy/migrate";
import { submitCommand } from "@/lib/sync/outbox";
import { registerDevice, pushCommands, pullChanges, snapshot, setSyncEpoch, syncEpoch } from "@/lib/sync/server";
import { syncOnce, Transport, NetworkError } from "@/lib/sync/worker";
import { createBackup } from "./service";
import { openBackup } from "./format";
import { prepareRecovery, stageReplace, applyPendingRestore, rescuePending, readRestoreLog, pendingRestore, discardRecovery } from "./restore";

const PASS = "correct horse battery staple 42";
const TENANT = { id: "t_test", name: "Test Traders" };
let dir: string;
let backups: string;
let cloud: PrismaClient;
let cloudFile: string;
const id: Record<string, string> = {};
const open: PrismaClient[] = [];
const url = (f: string) => `file:${f.replace(/\\/g, "/")}`;

async function migratedDb(file: string, key = "", opts: { dir?: string } = {}) {
  await applyMigrations(url(file), { encryptionKey: key || undefined, dir: opts.dir });
  const db = createPrismaClient(url(file), key);
  open.push(db);
  return db;
}

const backupOf = (db: PrismaClient, file: string, scope = "server", over: { dbKey?: string; tenant?: typeof TENANT; type?: "MANUAL" | "PRE_RESTORE" } = {}) =>
  createBackup({ db, dbFile: file, dbKey: over.dbKey, tenant: over.tenant ?? TENANT, scope, appVersion: "0.1.0" }, { directory: backups, passphrase: PASS, type: over.type ?? "MANUAL", trigger: "TEST" });

const count = async (file: string, sql: string, key = "") => {
  const c = createClient({ url: url(file), encryptionKey: key || undefined });
  try {
    return Number((await c.execute(sql)).rows[0].n);
  } finally {
    c.close();
  }
};

const sale = (qty: number) => ({
  type: "CREATE_DOCUMENT", actorUserId: id.clerk, docType: "SALE_INVOICE",
  input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: qty, unitPrice: 6 }] },
});

/** In-process transport whose upstream database can be swapped, as when the server is restored. */
function transportFor(deviceId: string, up: { db: PrismaClient; online: boolean }): Transport {
  return {
    upstreamId: "cloud",
    push: async (items) => {
      if (!up.online) throw new NetworkError("offline");
      return pushCommands(up.db, { id: deviceId, role: "DEVICE" }, items);
    },
    pull: async (since) => {
      if (!up.online) throw new NetworkError("offline");
      return pullChanges(up.db, since, 50);
    },
    snapshot: async () => {
      if (!up.online) throw new NetworkError("offline");
      return snapshot(up.db);
    },
  };
}

async function newDevice(name: string, key: string, up: { db: PrismaClient; online: boolean }) {
  const { device } = await registerDevice(up.db, { name, role: "DEVICE", registeredById: id.admin });
  const file = path.join(dir, `${device.code}.db`);
  const db = await migratedDb(file, key);
  return { device, db, file, transport: transportFor(device.id, up), local: { id: device.id, code: device.code } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "crm-restore-test-"));
  backups = path.join(dir, "Backups");
  fs.mkdirSync(backups);
  cloudFile = path.join(dir, "cloud.db");
  cloud = await migratedDb(cloudFile);
  await ensureAccountingSetup(cloud);
  id.admin = (await cloud.user.create({ data: { name: "Admin", email: "admin@t", password: "x", role: "ADMIN" } })).id;
  id.clerk = (await cloud.user.create({ data: { name: "Clerk", email: "clerk@t", password: "x", role: "EMPLOYEE" } })).id;
  const cat = await cloud.componentCategory.create({ data: { name: "Cups" } });
  id.cups = (await cloud.component.create({ data: { sku: "C1", name: "Paper cup", categoryId: cat.id } })).id;
  id.customer = (await cloud.ledgerAccount.create({ data: { code: "CUST", name: "Ali Traders Ltd", kind: "PARTY", subType: "CUSTOMER" } })).id;
  id.supplier = (await cloud.ledgerAccount.create({ data: { code: "SUPP", name: "Cup Mills", kind: "PARTY", subType: "SUPPLIER" } })).id;
  await createPurchaseInvoice(cloud, { id: id.admin, role: "ADMIN" }, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.cups, quantity: 1000, unitPrice: 4 }] });
});

afterAll(async () => {
  for (const db of open) await db.$disconnect().catch(() => undefined);
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {} // Windows may still hold SQLite files; a leftover temp folder is harmless
});

describe("validating a backup before anything is restored", () => {
  it("refuses another business's backup, a wrong passphrase, and a backup from a newer version; leaves nothing decrypted", async () => {
    const live = path.join(dir, "live-a", "app.db");
    fs.mkdirSync(path.dirname(live));
    const other = await backupOf(cloud, cloudFile, "server", { tenant: { id: "t_other", name: "Other Traders" } });
    await expect(prepareRecovery({ file: other.file, passphrase: PASS, tenantId: TENANT.id, liveDbFile: live })).rejects.toThrow(/another business/);

    const mine = await backupOf(cloud, cloudFile);
    await expect(prepareRecovery({ file: mine.file, passphrase: "wrong passphrase 123", tenantId: TENANT.id, liveDbFile: live })).rejects.toThrow(/Wrong passphrase/);
    const left = fs.readdirSync(path.join(path.dirname(live), "recovery")).filter((f) => f !== "restore-log.jsonl");
    expect(left).toEqual([]); // the failed attempt left no decrypted copy behind
    expect(readRestoreLog(live).map((e) => e.event)).toEqual(["PREPARE_FAILED"]);

    // A database whose newest migration this version of the application does not know
    const futureFile = path.join(dir, "future.db");
    const future = await migratedDb(futureFile);
    await future.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('f','x',current_timestamp,'20991231000000_from_the_future',current_timestamp,1)`);
    const newer = await backupOf(future, futureFile);
    await expect(prepareRecovery({ file: newer.file, passphrase: PASS, tenantId: TENANT.id, liveDbFile: live })).rejects.toThrow(/newer version/);
  });

  it("an older backup is upgraded in the isolated copy only, and reconciled there", async () => {
    // A database built by the previous release: every migration except the newest
    const oldDir = path.join(dir, "old-migrations");
    const names = fs.readdirSync(MIGRATIONS_DIR).filter((f) => fs.statSync(path.join(MIGRATIONS_DIR, f)).isDirectory()).sort();
    for (const n of names.slice(0, -1)) fs.cpSync(path.join(MIGRATIONS_DIR, n), path.join(oldDir, n), { recursive: true });
    const oldFile = path.join(dir, "old-release.db");
    const old = await migratedDb(oldFile, "", { dir: oldDir });
    await ensureAccountingSetup(old);
    const u = await old.user.create({ data: { name: "A", email: "a@old", password: "x", role: "ADMIN" } });
    const cat = await old.componentCategory.create({ data: { name: "Lids" } });
    const lid = await old.component.create({ data: { sku: "L1", name: "Lid", categoryId: cat.id } });
    const sup = await old.ledgerAccount.create({ data: { code: "S", name: "S", kind: "PARTY", subType: "SUPPLIER" } });
    await createPurchaseInvoice(old, { id: u.id, role: "ADMIN" }, { date: "2026-10-01", partyAccountId: sup.id, lines: [{ componentId: lid.id, quantity: 10, unitPrice: 2 }] });
    const b = await backupOf(old, oldFile);

    const live = path.join(dir, "live-b", "app.db");
    fs.mkdirSync(path.dirname(live));
    const plan = await prepareRecovery({ file: b.file, passphrase: PASS, tenantId: TENANT.id, liveDbFile: live });
    expect([plan.schemaAction, plan.checks.integrity, plan.checks.countsMatch, plan.checks.reconciliationErrors]).toEqual(["UPGRADED", "ok", true, []]);
    expect(plan.covered.accounting_documents).toBe(1);
    expect(await count(plan.recoveredFile, `SELECT count(*) n FROM "_prisma_migrations"`)).toBe(names.length);
    expect(await count(oldFile, `SELECT count(*) n FROM "_prisma_migrations"`)).toBe(names.length - 1); // the original is untouched
    expect(fs.existsSync(live)).toBe(false); // nothing live was created or changed
    discardRecovery(live, plan.recoveryId);
    // Removed, or (while Windows still holds the file) overwritten with zeros and swept at the next start
    const gone = !fs.existsSync(plan.recoveredFile) || fs.readFileSync(plan.recoveredFile).every((b) => b === 0);
    expect(gone).toBe(true);
  });
});

describe("replacing the live data", () => {
  it("needs the exact phrase and a safety backup; applies at start-up, keeps the previous file and never undoes security changes", async () => {
    // Business state at the backup: purchase + 1 sale; a temporary employee exists
    await createSaleInvoice(cloud, { id: id.admin, role: "ADMIN" }, { date: "2026-10-02", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 10, unitPrice: 6 }] });
    const temp = await cloud.user.create({ data: { name: "Temp", email: "temp@t", password: "x", role: "EMPLOYEE" } });
    const atBackup = await backupOf(cloud, cloudFile);
    // After the backup: another sale, the temporary employee deactivated, a user added, a computer registered
    await createSaleInvoice(cloud, { id: id.admin, role: "ADMIN" }, { date: "2026-10-03", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 5, unitPrice: 6 }] });
    await cloud.user.update({ where: { id: temp.id }, data: { isActive: false } });
    const newUser = await cloud.user.create({ data: { name: "New clerk", email: "new@t", password: "x", role: "EMPLOYEE" } });
    const { device: laterPc } = await registerDevice(cloud, { name: "Bought after the backup", role: "DEVICE", registeredById: id.admin });
    const latest = await backupOf(cloud, cloudFile);

    // The live database of the computer being restored. It is not opened in this process before the swap, as at a
    // real start-up (Windows keeps SQLite files locked by a process that opened them); counts come from a copy.
    const live = path.join(dir, "live-c", "app.db");
    fs.mkdirSync(path.dirname(live));
    await openBackup(latest.file, live, PASS);
    const copy = path.join(dir, "live-c-copy.db");
    fs.copyFileSync(live, copy);
    const copyDb = createPrismaClient(url(copy), "");
    open.push(copyDb);
    const plan = await prepareRecovery({ file: atBackup.file, passphrase: PASS, tenantId: TENANT.id, liveDbFile: live, live: copyDb });
    expect(plan.wouldLose.join("; ")).toMatch(/1 accounting documents recorded after this backup/);
    expect(plan.confirmationPhrase).toBe(`RESTORE TEST TRADERS ${plan.manifest.createdAt.slice(0, 10)}`);

    expect(() => stageReplace({ liveDbFile: live, recoveryId: plan.recoveryId, confirmation: "RESTORE", userId: id.admin, safetyBackupId: "x" })).toThrow(/Type exactly/);
    expect(() => stageReplace({ liveDbFile: live, recoveryId: plan.recoveryId, confirmation: plan.confirmationPhrase, userId: id.admin, safetyBackupId: "" })).toThrow(/safety backup/);
    expect(pendingRestore(live)).toBeNull();
    stageReplace({ liveDbFile: live, recoveryId: plan.recoveryId, confirmation: plan.confirmationPhrase, userId: id.admin, safetyBackupId: latest.backupId });

    // A failed swap (the recovered file has gone) puts everything back and keeps the restore staged
    const pendingFile = path.join(path.dirname(live), "recovery", "restore-pending.json");
    const staged = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
    const liveBytes = fs.readFileSync(live);
    fs.writeFileSync(pendingFile, JSON.stringify({ ...staged, recoveredFile: path.join(dir, "missing.db") }));
    expect((await applyPendingRestore(live, ""))?.event).toBe("FAILED");
    expect(fs.readFileSync(live).equals(liveBytes)).toBe(true);
    expect(fs.existsSync(pendingFile)).toBe(true);
    fs.writeFileSync(pendingFile, JSON.stringify(staged));

    // "Start-up"
    const applied = await applyPendingRestore(live, "");
    expect(applied?.event).toBe("APPLIED");
    expect(await count(live, "SELECT count(*) n FROM accounting_documents")).toBe(2); // business data as at the backup
    expect(await count(String(applied!.previousDatabaseKeptAs), "SELECT count(*) n FROM accounting_documents")).toBe(3); // previous kept
    expect(await count(live, `SELECT count(*) n FROM users WHERE id = '${temp.id}' AND isActive = 0`)).toBe(1); // deactivation kept
    expect(await count(live, `SELECT count(*) n FROM users WHERE id = '${newUser.id}'`)).toBe(1); // account kept
    expect(await count(live, `SELECT count(*) n FROM devices WHERE id = '${laterPc.id}'`)).toBe(1); // registration kept
    expect(await count(live, `SELECT count(*) n FROM node_state WHERE key = 'SYNC_EPOCH'`)).toBe(1); // computers will resync
    expect(await count(live, `SELECT count(*) n FROM audit_logs WHERE action = 'RESTORE' AND entityId = '${atBackup.backupId}'`)).toBe(1);
    expect(pendingRestore(live)).toBeNull();
    expect(await applyPendingRestore(live, "")).toBeNull(); // the next start does nothing
    expect(readRestoreLog(live).map((e) => e.event)).toEqual(["PREPARED", "STAGED", "FAILED", "APPLIED"]);
  });
});

describe("recovering computers", () => {
  it("a computer that failed before syncing: its unsent entries are rescued on a replacement and posted exactly once", async () => {
    const up = { db: cloud, online: true };
    const d1 = await newDevice("Counter PC", "key-of-the-failed-pc-".padEnd(40, "1"), up);
    await syncOnce(d1.db, d1.transport);
    up.online = false;
    const a = await submitCommand(d1.db, d1.local, sale(1));
    const b = await submitCommand(d1.db, d1.local, sale(2));
    const c = await submitCommand(d1.db, d1.local, sale(3));
    const lastBackup = await backupOf(d1.db, d1.file, "device-D01", { dbKey: "key-of-the-failed-pc-".padEnd(40, "1") });
    // Its first entry did reach the server just before the computer failed (the answer never came back)
    up.online = true;
    await pushCommands(cloud, { id: d1.device.id, role: "DEVICE" }, [JSON.parse(a.payload)]);
    const before = await cloud.accountingDocument.count();

    // Replacement computer: new database key, only the backup file and the passphrase
    const d2 = await newDevice("Replacement PC", "key-of-the-new-pc-".padEnd(40, "2"), up);
    await syncOnce(d2.db, d2.transport);
    const plan = await prepareRecovery({ file: lastBackup.file, passphrase: PASS, tenantId: TENANT.id, liveDbFile: d2.file, live: d2.db, liveKey: "key-of-the-new-pc-".padEnd(40, "2") });
    expect(plan.pendingInBackup).toBe(3);
    const rescued = await rescuePending(d2.db, plan.recoveredFile, "key-of-the-new-pc-".padEnd(40, "2"));
    expect(rescued).toEqual({ added: 3, skipped: 0 });
    expect(await rescuePending(d2.db, plan.recoveredFile, "key-of-the-new-pc-".padEnd(40, "2"))).toEqual({ added: 0, skipped: 3 }); // twice is harmless

    const report = await syncOnce(d2.db, d2.transport);
    expect([report.accepted, report.needsReview, report.error]).toEqual([3, 0, undefined]);
    expect(await cloud.accountingDocument.count()).toBe(before + 2); // b and c posted; a not posted twice
    for (const cmd of [a, b, c]) expect(await cloud.accountingDocument.count({ where: { commandId: cmd.id } })).toBe(1);
    // A reused entry id with different content is refused, never posted
    const tampered = { ...JSON.parse(b.payload), input: { ...JSON.parse(b.payload).input, lines: [{ componentId: id.cups, quantity: 99, unitPrice: 6 }] } };
    const [r] = await pushCommands(cloud, { id: d2.device.id, role: "DEVICE" }, [tampered]);
    expect(r.outcome.status).toBe("CONFLICT");
  });

  it("when the server is restored to an earlier point, computers resend what it lost and resynchronise: nothing lost, nothing doubled", async () => {
    const up = { db: cloud, online: true };
    const d = await newDevice("Office PC", "", up);
    await syncOnce(d.db, d.transport);
    const early = await submitCommand(d.db, d.local, sale(1));
    await syncOnce(d.db, d.transport);
    const serverBackup = await backupOf(cloud, cloudFile);
    const late = await submitCommand(d.db, d.local, sale(2));
    expect((await syncOnce(d.db, d.transport)).accepted).toBe(1);
    const lostDocId = (await d.db.accountingDocument.findUniqueOrThrow({ where: { commandId: late.id } })).id;

    // The server is restored from the backup (its file replaced): the late entry is gone there
    const restoredFile = path.join(dir, "cloud-restored.db");
    await openBackup(serverBackup.file, restoredFile, PASS);
    const restored = createPrismaClient(url(restoredFile), "");
    open.push(restored);
    await setSyncEpoch(restored, { id: "after-restore-1", backupCreatedAt: new Date().toISOString() });
    expect(await restored.accountingDocument.count({ where: { commandId: late.id } })).toBe(0);
    up.db = restored;

    const report = await syncOnce(d.db, d.transport);
    expect(report.error).toBeUndefined();
    expect(report.upstreamRestored?.resent).toBeGreaterThanOrEqual(1);
    expect(await restored.accountingDocument.count({ where: { commandId: late.id } })).toBe(1); // resent and posted
    expect(await restored.accountingDocument.count({ where: { commandId: early.id } })).toBe(1); // not doubled
    // The replica matches the restored server exactly: the lost row is gone, history rows too
    expect(await d.db.accountingDocument.count({ where: { id: lostDocId } })).toBe(0);
    expect(await d.db.accountingDocument.count()).toBe(await restored.accountingDocument.count());
    expect(await d.db.journalLine.count()).toBe(await restored.journalLine.count());
    expect(await d.db.stockMovement.count()).toBe(await restored.stockMovement.count());
    // The append-only guard is back in force on the replica
    await expect(d.db.$executeRawUnsafe(`DELETE FROM journal_lines`)).rejects.toThrow(/append-only/);
    // This computer starts its own new epoch so anything syncing from it resynchronises too
    expect((await syncEpoch(d.db)).id).not.toBe("initial");
    // The next cycle is normal
    const next = await syncOnce(d.db, d.transport);
    expect([next.error, next.upstreamRestored]).toEqual([undefined, undefined]);
  });
});
