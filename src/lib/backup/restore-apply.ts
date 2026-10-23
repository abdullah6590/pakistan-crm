// src/lib/backup/restore-apply.ts - The start-up half of a restore (Report 23 §3). It imports nothing that opens a
// database, so it can swap the database file before the application touches it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

export const recoveryRoot = (dbFile: string) => path.join(path.dirname(dbFile), "recovery");
const logFile = (dbFile: string) => path.join(recoveryRoot(dbFile), "restore-log.jsonl");

export function logRestore(dbFile: string, entry: Record<string, unknown>) {
  fs.mkdirSync(recoveryRoot(dbFile), { recursive: true });
  fs.appendFileSync(logFile(dbFile), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function readRestoreLog(dbFile: string): Record<string, unknown>[] {
  if (!fs.existsSync(logFile(dbFile))) return [];
  return fs.readFileSync(logFile(dbFile), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** The staged restore, if an administrator confirmed one that has not been applied yet. */
export function pendingRestore(dbFile: string): Record<string, string> | null {
  const f = path.join(recoveryRoot(dbFile), "restore-pending.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

/**
 * Called at start-up before the database is opened: swap in the staged recovered database and keep the previous
 * file as `<db>.before-restore-<time>`. Returns what happened (or null when nothing is staged).
 */
export async function applyPendingRestore(liveDbFile: string, dbKey = process.env.CRM_DB_ENCRYPTION_KEY || ""): Promise<Record<string, unknown> | null> {
  try {
    sweepDiscardedRecoveries(liveDbFile);
  } catch {
    /* tried again at the next start */
  }
  const pending = pendingRestore(liveDbFile);
  if (!pending) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const kept = `${liveDbFile}.before-restore-${stamp}`;
  const moved: string[] = [];
  try {
    if (!fs.existsSync(pending.recoveredFile)) throw new Error("The recovered database file is missing");
    for (const ext of ["", "-wal", "-shm"]) {
      if (!fs.existsSync(liveDbFile + ext)) continue;
      fs.renameSync(liveDbFile + ext, kept + ext);
      moved.push(ext);
    }
    fs.copyFileSync(pending.recoveredFile, liveDbFile);
    if (fs.existsSync(pending.recoveredFile + "-wal")) fs.copyFileSync(pending.recoveredFile + "-wal", liveDbFile + "-wal");
    const carried = await finishRestore(liveDbFile, moved.includes("") ? kept : null, dbKey, pending);
    fs.rmSync(path.join(recoveryRoot(liveDbFile), "restore-pending.json"));
    const result = { event: "APPLIED", ...pending, previousDatabaseKeptAs: kept, carried };
    logRestore(liveDbFile, result);
    return result;
  } catch (e) {
    // Put the original back exactly as it was; the staged restore stays for another attempt
    try {
      if (moved.includes("")) for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(liveDbFile + ext)) fs.rmSync(liveDbFile + ext);
      for (const ext of moved) fs.renameSync(kept + ext, liveDbFile + ext);
    } catch (undo) {
      const result = { event: "ROLLBACK_FAILED", ...pending, error: (e as Error).message, undoError: (undo as Error).message, previousDatabaseKeptAs: kept };
      logRestore(liveDbFile, result); // Report 23 §3.4: stop the application and copy the kept file back by hand
      return result;
    }
    const result = { event: "FAILED", ...pending, error: (e as Error).message };
    logRestore(liveDbFile, result);
    return result;
  }
}

/** Recovered copies an administrator discarded but Windows still held open are removed at the next start. */
export function sweepDiscardedRecoveries(dbFile: string) {
  const root = recoveryRoot(dbFile);
  if (!fs.existsSync(root)) return;
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    if (fs.existsSync(path.join(dir, ".discarded"))) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Restoring business data never undoes a security or machine setting made since the backup: user accounts (roles,
 * deactivations, password changes), registered computers (including revocations) and this computer's backup and
 * Google Drive settings are carried over from the previous database when it can still be read. A new sync epoch
 * tells the computers that sync from this one to resend and resynchronise (Report 23 §5).
 */
const CARRIED = [
  { table: "users", key: "id" },
  { table: "devices", key: "id" },
  { table: "backup_settings", key: "id" },
  { table: "backup_runs", key: "id" },
  { table: "drive_connections", key: "id" },
];

async function finishRestore(liveDbFile: string, previousFile: string | null, dbKey: string, pending: Record<string, string>) {
  const url = (f: string) => `file:${f.replace(/\\/g, "/")}`;
  const next = createClient({ url: url(liveDbFile), encryptionKey: dbKey });
  const carried: Record<string, number | string> = {};
  try {
    if (previousFile) {
      const prev = createClient({ url: url(previousFile), encryptionKey: dbKey });
      try {
        for (const { table, key } of CARRIED) {
          try {
            const cols = new Set((await next.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => String(r.name)));
            const rows = (await prev.execute(`SELECT * FROM "${table}"`)).rows;
            let n = 0;
            for (const row of rows) {
              const names = Object.keys(row).filter((c) => cols.has(c));
              const quoted = names.map((c) => `"${c}"`).join(", ");
              const updates = names.filter((c) => c !== key).map((c) => `"${c}" = excluded."${c}"`).join(", ");
              await next.execute({
                sql: `INSERT INTO "${table}" (${quoted}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT("${key}") DO UPDATE SET ${updates}`,
                args: names.map((c) => row[c] as never),
              });
              n++;
            }
            carried[table] = n;
          } catch (e) {
            carried[table] = `not carried over: ${(e as Error).message}`;
          }
        }
      } finally {
        prev.close();
      }
    }
    const epoch = JSON.stringify({ id: crypto.randomUUID(), backupCreatedAt: pending.backupCreatedAt });
    await next.execute({ sql: `INSERT INTO "node_state" ("key", "value", "updatedAt") VALUES ('SYNC_EPOCH', ?, CURRENT_TIMESTAMP) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP`, args: [epoch] });
    await next.execute({
      sql: `INSERT INTO "audit_logs" ("id", "entity", "entityId", "action", "userId", "reason", "after", "createdAt") VALUES (?, 'Database', ?, 'RESTORE', ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [crypto.randomUUID(), pending.backupId, pending.stagedBy, `Restored from backup ${pending.backupId}`, JSON.stringify({ recoveryId: pending.recoveryId, safetyBackupId: pending.safetyBackupId, carried })],
    });
  } finally {
    next.close();
  }
  return carried;
}
