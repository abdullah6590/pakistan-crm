// src/lib/backup/service.ts - Create, verify and prune local encrypted backups (Report 22).
// A backup is reported VERIFIED only after it was decrypted again, matched its checksum, passed SQLite's
// integrity check and showed the same record counts as the snapshot it came from.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { listMigrations } from "@/lib/tenancy/migrate";
import { BackupManifest, openBackup, readManifest, sealBackup, sha256File } from "./format";

export const COUNTED_TABLES = ["users", "ledger_accounts", "components", "accounting_documents", "accounting_document_lines", "journal_lines", "stock_movements", "charge_records", "audit_logs", "outbox_commands", "devices"];

export interface BackupTarget {
  db: PrismaClient;
  /** File path of the live database (from DATABASE_URL). */
  dbFile: string;
  /** Device database key (desktops); travels wrapped with the passphrase key. */
  dbKey?: string;
  tenant: { id: string; name: string };
  scope: string;
  appVersion: string;
}

export class BackupError extends Error {}

export function dbFileFromUrl(url: string): string {
  if (!url.startsWith("file:")) throw new BackupError("Only local database files can be backed up from this computer");
  return path.resolve(url.slice(5).replace(/^\/\/(?=[A-Za-z]:)/, ""));
}

const COUNT_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const req = createRequire(workerData.project + "/package.json");
const { createClient } = req("@libsql/client");
(async () => {
  const c = createClient({ url: workerData.url, encryptionKey: workerData.key || undefined });
  const integrity = String((await c.execute("PRAGMA integrity_check")).rows[0].integrity_check);
  const counts = {};
  for (const t of workerData.tables) {
    try { counts[t] = Number((await c.execute('SELECT count(*) AS n FROM "' + t + '"')).rows[0].n); } catch { counts[t] = -1; }
  }
  const pending = await c.execute("SELECT count(*) AS n FROM outbox_commands WHERE status IN ('PENDING_SYNC','SYNCING','FAILED_RETRY','RELAYED','NEEDS_REVIEW')").catch(() => null);
  counts.pendingSyncEntries = pending ? Number(pending.rows[0].n) : 0;
  const seq = await c.execute("SELECT COALESCE(MAX(seq),0) AS m FROM change_log").catch(() => null);
  const hist = await c.execute("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name").catch(() => null);
  c.close();
  parentPort.postMessage({ integrity, counts, changeSeq: seq ? Number(seq.rows[0].m) : 0,
    schema: hist && hist.rows.length ? String(hist.rows[hist.rows.length - 1].migration_name) : "unknown", migrations: hist ? hist.rows.length : 0 });
})().catch((e) => parentPort.postMessage({ error: String(e && e.message || e) }));
`;

/**
 * Integrity check and record counts of a snapshot, in a short-lived worker thread: the database driver releases
 * Windows file handles only when its objects are destroyed, which a finished worker guarantees, so the scratch
 * copy (decrypted data) can be deleted immediately afterwards.
 */
async function countRows(url: string, key?: string): Promise<{ integrity: string; counts: Record<string, number>; changeSeq: number; schema: string; migrations: number }> {
  const { Worker } = await import("node:worker_threads");
  return new Promise((resolve, reject) => {
    const w = new Worker(/* turbopackIgnore: true */ COUNT_WORKER, { eval: true, workerData: { url, key: key ?? "", tables: COUNTED_TABLES, project: (/* turbopackIgnore: true */ process.cwd()).replace(/\\/g, "/") } });
    let result: unknown = null;
    w.on("message", (m) => (result = m));
    w.on("error", reject);
    w.on("exit", () => {
      const r = result as { error?: string } | null;
      if (!r) reject(new BackupError("Verification could not run"));
      else if (r.error) reject(new BackupError(`Verification could not open the copy: ${r.error}`));
      else resolve(r as never);
    });
  });
}

/**
 * A plain copy of the live database taken just before a one-time change (opening stock), kept next to it in `backups/`.
 * It counts only once it opens, passes the integrity check and holds the same records as the live database.
 */
export async function safetySnapshot(target: Pick<BackupTarget, "db" | "dbFile" | "dbKey">, label: string): Promise<string> {
  // Decided at run time (next to the live database): the build must not try to find and pack this folder
  const dir = path.join(/* turbopackIgnore: true */ path.dirname(target.dbFile), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(/* turbopackIgnore: true */ dir, `${path.basename(target.dbFile, ".db")}.backup-${stamp}-${label}.db`);
  await target.db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  const copy = await countRows(`file:${file.replace(/\\/g, "/")}`, target.dbKey);
  if (copy.integrity !== "ok") throw new BackupError(`The safety copy failed its integrity check: ${copy.integrity}`);
  const live = await countRows(`file:${target.dbFile.replace(/\\/g, "/")}`, target.dbKey);
  const differs = COUNTED_TABLES.filter((t) => copy.counts[t] !== live.counts[t]);
  if (differs.length) throw new BackupError(`The safety copy does not match the database (${differs.join(", ")}); try again`);
  return file;
}

/** Scratch space for snapshots; it briefly holds decrypted data, so it is always wiped (Report 22 §3.4). */
const WORK_ROOT = () => {
  const root = path.join(os.tmpdir(), "pakistan-crm-backup-work");
  fs.mkdirSync(root, { recursive: true });
  return root;
};

/** Windows may hold a database file briefly after it is closed: retry, and overwrite plaintext if removal fails. */
export function removeWorkDir(work: string) {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    for (const f of fs.existsSync(work) ? fs.readdirSync(work) : []) {
      try {
        const p = path.join(work, f);
        fs.writeFileSync(p, Buffer.alloc(Math.min(fs.statSync(p).size, 256 * 1024 * 1024)));
      } catch {
        /* the next sweep removes it */
      }
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove scratch folders left by an earlier run (crash, power cut or a locked file). A folder belonging to another
 * process that is still running is left alone, unless it is over six hours old (D-018).
 */
export function sweepWorkDirs() {
  const root = WORK_ROOT();
  for (const d of fs.readdirSync(root)) {
    const full = path.join(root, d);
    const pid = Number(d.match(/^run-(\d+)-/)?.[1] ?? NaN);
    const age = Date.now() - fs.statSync(full).mtimeMs;
    const ours = pid === process.pid;
    if (!ours && Number.isFinite(pid) && processAlive(pid) && age < 6 * 3600_000) continue;
    if (ours && age < 6 * 3600_000) continue; // our own runs clean up after themselves
    removeWorkDir(full);
  }
}

function freeBytes(dir: string): number {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/**
 * Snapshot → seal → verify → record. The live database is copied with VACUUM INTO (a consistent snapshot even
 * while the application is writing); locally pending sync entries are part of it.
 */
export async function createBackup(
  target: BackupTarget,
  opts: { directory: string; passphrase: string; type: BackupManifest["type"]; trigger: string; changeMarker?: number; freeSpace?: (dir: string) => number },
) {
  const backupId = crypto.randomUUID();
  const startedAt = new Date();
  await target.db.backupRun.create({ data: { id: backupId, type: opts.type, status: "RUNNING", trigger: opts.trigger, startedAt } });
  sweepWorkDirs();
  const work = fs.mkdtempSync(path.join(WORK_ROOT(), `run-${process.pid}-`));
  const snap = path.join(work, "snapshot.db");
  const check = path.join(work, "verify.db");
  let finalFile: string | null = null;
  try {
    if (!opts.directory) throw new BackupError("Choose a backup folder first");
    const scopeDir = path.join(opts.directory, target.tenant.id, target.scope);
    fs.mkdirSync(scopeDir, { recursive: true });
    const needed = fs.statSync(target.dbFile).size * 2 + 50 * 1024 * 1024;
    const free = (opts.freeSpace ?? freeBytes)(scopeDir);
    if (free < needed) throw new BackupError(`Not enough space in the backup folder: ${Math.round(free / 1048576)} MB free, about ${Math.round(needed / 1048576)} MB needed`);

    await target.db.$executeRawUnsafe(`VACUUM INTO '${snap.replace(/\\/g, "/").replace(/'/g, "''")}'`);
    const source = await countRows(`file:${snap.replace(/\\/g, "/")}`, target.dbKey);
    if (source.integrity !== "ok") throw new BackupError(`The database snapshot failed its integrity check: ${source.integrity}`);
    const code = listMigrations();
    const manifest: BackupManifest = {
      format: "PKCRMBK1", backupId, tenantId: target.tenant.id, tenantName: target.tenant.name, scope: target.scope, type: opts.type,
      createdAt: startedAt.toISOString(), appVersion: target.appVersion,
      schemaVersion: source.schema !== "unknown" ? source.schema : code[code.length - 1]?.name ?? "unknown",
      migrationCount: source.migrations || code.length, changeSeq: source.changeSeq,
      plainSha256: await sha256File(snap), plainBytes: fs.statSync(snap).size, counts: source.counts, dbEncrypted: !!target.dbKey,
    };
    const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    finalFile = path.join(scopeDir, `${stamp}_${opts.type}_${backupId.slice(0, 8)}.pkbk`);
    const partial = `${finalFile}.partial`;
    await sealBackup(snap, partial, opts.passphrase, manifest, target.dbKey);
    fs.renameSync(partial, finalFile);
    fs.writeFileSync(`${finalFile}.manifest.json`, JSON.stringify(manifest, null, 2));

    // Verification: a file existing is not proof of a backup
    const opened = await openBackup(finalFile, check, opts.passphrase);
    if ((await sha256File(check)) !== manifest.plainSha256) throw new BackupError("Verification failed: checksum mismatch after decryption");
    const restored = await countRows(`file:${check.replace(/\\/g, "/")}`, opened.dbKey);
    if (restored.integrity !== "ok") throw new BackupError(`Verification failed: integrity check ${restored.integrity}`);
    if (JSON.stringify(restored.counts) !== JSON.stringify(source.counts)) throw new BackupError("Verification failed: record counts differ");

    const size = fs.statSync(finalFile).size;
    await target.db.backupRun.update({
      where: { id: backupId },
      data: { status: "VERIFIED", file: finalFile, sizeBytes: size, changeSeq: opts.changeMarker ?? manifest.changeSeq, manifest: JSON.stringify(manifest), finishedAt: new Date() },
    });
    return { backupId, file: finalFile, size, manifest };
  } catch (e) {
    // A failed attempt leaves no half-written package behind
    if (finalFile) for (const f of [finalFile, `${finalFile}.partial`, `${finalFile}.manifest.json`]) fs.rmSync(f, { force: true });
    const message = (e as Error).message.slice(0, 500);
    await target.db.backupRun.update({ where: { id: backupId }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    throw e instanceof BackupError ? e : new BackupError(message);
  } finally {
    removeWorkDir(work);
  }
}

/**
 * Retention: keep the newest `keepDaily` daily, `keepFrequent` frequent, 10 manual and 10 pre-restore backups.
 * The newest verified backup is never removed, so a valid recovery copy always remains.
 */
export async function applyRetention(db: PrismaClient, policy: { keepDaily: number; keepFrequent: number }) {
  const runs = await db.backupRun.findMany({ where: { status: "VERIFIED" }, orderBy: { startedAt: "desc" } });
  if (!runs.length) return [];
  const driveActive = (await db.driveConnection.findUnique({ where: { id: "local" } }))?.status === "CONNECTED";
  const newest = runs[0].id;
  const limits: Record<string, number> = { DAILY: Math.max(1, policy.keepDaily), FREQUENT: Math.max(0, policy.keepFrequent), MANUAL: 10, PRE_RESTORE: 10 };
  const seen: Record<string, number> = {};
  const removed: string[] = [];
  for (const r of runs) {
    seen[r.type] = (seen[r.type] ?? 0) + 1;
    if (r.id === newest || seen[r.type] <= (limits[r.type] ?? 10)) continue;
    // Only uploaded-or-not-required copies are pruned locally; a backup still waiting for Google Drive is kept
    if (driveActive && r.uploadStatus && r.uploadStatus !== "UPLOADED") continue;
    if (r.file) for (const f of [r.file, `${r.file}.manifest.json`]) fs.rmSync(f, { force: true });
    await db.backupRun.update({ where: { id: r.id }, data: { status: "DELETED" } });
    removed.push(r.id);
  }
  return removed;
}

/** Which backups are due now (also used at startup to catch up a missed daily backup). */
export function dueBackups(now: Date, s: { enabled: boolean; dailyTime: string; frequentMinutes: number }, last: { daily?: Date | null; any?: Date | null; anySeq?: number | null }, changeSeq: number) {
  if (!s.enabled) return { daily: false, frequent: false, missed: false };
  const [h, m] = s.dailyTime.split(":").map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(h, m, 0, 0);
  const daily = now >= scheduled && (!last.daily || last.daily < scheduled);
  const missed = daily && now.getTime() - scheduled.getTime() > 15 * 60_000;
  const frequent = !daily && s.frequentMinutes > 0 && (!last.any || now.getTime() - last.any.getTime() >= s.frequentMinutes * 60_000) && (last.anySeq === null || last.anySeq === undefined || changeSeq > last.anySeq);
  return { daily, frequent, missed };
}

export function verifyPackage(file: string) {
  return readManifest(file);
}

/**
 * A number that grows whenever something worth protecting changes: replicated data (change log) or entries made
 * on this computer (the outbox is not in the change log). Used to skip frequent backups when nothing changed.
 */
export async function changeMarker(db: PrismaClient): Promise<number> {
  const cl = (await db.$queryRawUnsafe(`SELECT COALESCE(MAX(seq),0) AS m FROM change_log`)) as { m: number | bigint }[];
  const ob = await db.outboxCommand.aggregate({ _max: { seq: true }, _count: true, where: { seq: { gt: 0 } } });
  return Number(cl[0].m) + (ob._max.seq ?? 0) + ob._count;
}
