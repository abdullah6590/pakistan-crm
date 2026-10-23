// src/lib/backup/restore.ts - Restore and disaster recovery (Report 23).
// Nothing live is changed until: the backup is validated (integrity, passphrase, business, schema), recovered into an
// isolated copy and reconciled there, a verified safety backup of the live data exists, and an administrator has
// confirmed with the exact phrase. Replacing the live database happens at the next start of the application, before
// anything opens the database; the previous database file is kept.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createClient } from "@libsql/client";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations, listMigrations } from "@/lib/tenancy/migrate";
import { reconcileCentral } from "@/lib/sync/reconcile";
import { openBackup, readManifest, BackupManifest } from "./format";
import { BackupError, removeWorkDir } from "./service";
import { recoveryRoot, logRestore, pendingRestore } from "./restore-apply";

export { applyPendingRestore, readRestoreLog, pendingRestore } from "./restore-apply";

export type RestoreMode = "REPLACE" | "SEPARATE" | "RESCUE_PENDING";

export interface RecoveryPlan {
  recoveryId: string;
  source: string;
  manifest: BackupManifest;
  recoveredFile: string;
  schemaAction: "SAME" | "UPGRADED";
  checks: { integrity: string; countsMatch: boolean; reconciliationErrors: string[] };
  covered: Record<string, number>;
  current: Record<string, number> | null;
  wouldLose: string[];
  pendingInBackup: number;
  confirmationPhrase: string;
}

async function counts(db: PrismaClient) {
  const tables = ["accounting_documents", "journal_lines", "stock_movements", "users", "ledger_accounts", "charge_records", "outbox_commands"];
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number(((await db.$queryRawUnsafe(`SELECT count(*) AS n FROM "${t}"`)) as { n: bigint | number }[])[0].n);
  return out;
}

/**
 * Step 1-3: validate the backup and recover it into an isolated copy beside the live database, then reconcile it.
 * `expect.tenantId` must match: a business can never load another business's backup.
 */
export async function prepareRecovery(opts: { file: string; passphrase: string; tenantId: string; liveDbFile: string; live?: PrismaClient; liveKey?: string }): Promise<RecoveryPlan> {
  const liveKey = opts.liveKey ?? (process.env.CRM_DB_ENCRYPTION_KEY || "");
  const manifest = readManifest(opts.file);
  if (manifest.tenantId !== opts.tenantId) throw new BackupError(`This backup belongs to another business (${manifest.tenantName}); it cannot be restored here`);
  const code = listMigrations().map((m) => m.name);
  if (manifest.schemaVersion !== "unknown" && !code.includes(manifest.schemaVersion)) {
    throw new BackupError(`This backup was made by a newer version of the application (${manifest.schemaVersion}); update the application first`);
  }
  const recoveryId = crypto.randomUUID();
  const dir = path.join(recoveryRoot(opts.liveDbFile), recoveryId);
  fs.mkdirSync(dir, { recursive: true });
  const recoveredFile = path.join(dir, "recovered.db");
  try {
    return await recover(opts, liveKey, manifest, recoveryId, dir, recoveredFile);
  } catch (e) {
    removeWorkDir(dir); // a failed recovery leaves no decrypted data behind
    logRestore(opts.liveDbFile, { event: "PREPARE_FAILED", recoveryId, backupId: manifest.backupId, source: opts.file, error: (e as Error).message });
    throw e;
  }
}

async function recover(
  opts: { file: string; passphrase: string; liveDbFile: string; live?: PrismaClient },
  liveKey: string, manifest: BackupManifest, recoveryId: string, dir: string, recoveredFile: string,
): Promise<RecoveryPlan> {
  const opened = await openBackup(opts.file, recoveredFile, opts.passphrase);
  const url = `file:${recoveredFile.replace(/\\/g, "/")}`;
  // Without a migration history the database's version cannot be known, so it cannot be upgraded safely
  const history = createClient({ url, encryptionKey: opened.dbKey });
  try {
    const rows = await history.execute(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'`);
    if (!Number(rows.rows[0].n)) throw new BackupError("This backup has no record of its database version, so it cannot be checked against this version of the application");
  } finally {
    history.close();
  }
  // An older backup is upgraded in the isolated copy only (never in place)
  const upgraded = await applyMigrations(url, { encryptionKey: opened.dbKey }).catch((e) => {
    throw new BackupError(`The backup could not be upgraded to this version: ${(e as Error).message}`);
  });
  // The copy must open with THIS computer's database key: a replacement computer has a new key (Report 23 §2.4)
  if ((opened.dbKey ?? "") !== liveKey) {
    const c = createClient({ url, encryptionKey: opened.dbKey });
    try {
      await c.execute(`PRAGMA rekey='${liveKey.replace(/'/g, "''")}'`);
    } finally {
      c.close();
    }
  }
  const rec = createPrismaClient(url, liveKey);
  try {
    const integrity = String(((await rec.$queryRawUnsafe("PRAGMA integrity_check")) as { integrity_check: string }[])[0].integrity_check);
    const covered = await counts(rec);
    const countsMatch = ["accounting_documents", "journal_lines", "stock_movements"].every((t) => manifest.counts[t] === undefined || manifest.counts[t] === covered[t]);
    const reconciliationErrors = (await reconcileCentral(rec)).findings.filter((f) => f.severity === "ERROR").map((f) => `${f.check}: ${f.message}`);
    const pendingInBackup = Number(((await rec.$queryRawUnsafe(`SELECT count(*) AS n FROM outbox_commands WHERE status IN ('PENDING_SYNC','SYNCING','FAILED_RETRY','RELAYED','NEEDS_REVIEW')`)) as { n: bigint }[])[0].n);
    let current: Record<string, number> | null = null;
    const wouldLose: string[] = [];
    if (opts.live) {
      current = await counts(opts.live).catch(() => null);
      if (current) for (const [t, n] of Object.entries(current)) if (n > (covered[t] ?? 0)) wouldLose.push(`${n - (covered[t] ?? 0)} ${t.replace(/_/g, " ")} recorded after this backup`);
    }
    if (integrity !== "ok") throw new BackupError(`The recovered copy failed its integrity check: ${integrity}`);
    const plan: RecoveryPlan = {
      recoveryId, source: opts.file, manifest, recoveredFile, schemaAction: upgraded.applied.length ? "UPGRADED" : "SAME",
      checks: { integrity, countsMatch, reconciliationErrors }, covered, current, wouldLose, pendingInBackup,
      confirmationPhrase: `RESTORE ${manifest.tenantName.toUpperCase()} ${manifest.createdAt.slice(0, 10)}`,
    };
    await rec.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => undefined);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
    logRestore(opts.liveDbFile, { event: "PREPARED", recoveryId, backupId: manifest.backupId, source: opts.file, schemaAction: plan.schemaAction, integrity, countsMatch, reconciliationErrors });
    return plan;
  } finally {
    await rec.$disconnect();
  }
}

export function readPlan(liveDbFile: string, recoveryId: string): RecoveryPlan {
  if (!/^[0-9a-f-]{36}$/.test(recoveryId)) throw new BackupError("Unknown recovery");
  const planFile = path.join(recoveryRoot(liveDbFile), recoveryId, "plan.json");
  if (!fs.existsSync(planFile)) throw new BackupError("Prepare the recovery first");
  return JSON.parse(fs.readFileSync(planFile, "utf8")) as RecoveryPlan;
}

/** Remove a recovered copy that is no longer needed (never one that is staged to replace the live data). */
export function discardRecovery(liveDbFile: string, recoveryId: string) {
  readPlan(liveDbFile, recoveryId);
  const pending = pendingRestore(liveDbFile);
  if (pending?.recoveryId === recoveryId) throw new BackupError("This recovery is staged; cancel the restore first");
  const dir = path.join(recoveryRoot(liveDbFile), recoveryId);
  fs.writeFileSync(path.join(dir, ".discarded"), new Date().toISOString()); // swept at the next start if still here
  removeWorkDir(dir);
  logRestore(liveDbFile, { event: "DISCARDED", recoveryId });
}

/** Step 7: stage the replacement; it is applied when the application next starts. Requires the exact phrase. */
export function stageReplace(opts: { liveDbFile: string; recoveryId: string; confirmation: string; userId: string; safetyBackupId: string }) {
  const plan = readPlan(opts.liveDbFile, opts.recoveryId);
  if (opts.confirmation.trim() !== plan.confirmationPhrase) throw new BackupError(`Type exactly: ${plan.confirmationPhrase}`);
  if (plan.checks.reconciliationErrors.length) throw new BackupError("The recovered copy has accounting errors; it will not replace the live data");
  if (!opts.safetyBackupId) throw new BackupError("A verified safety backup of the current data is required first");
  const pending = { recoveryId: opts.recoveryId, recoveredFile: plan.recoveredFile, backupId: plan.manifest.backupId, backupCreatedAt: plan.manifest.createdAt, stagedBy: opts.userId, stagedAt: new Date().toISOString(), safetyBackupId: opts.safetyBackupId };
  fs.writeFileSync(path.join(recoveryRoot(opts.liveDbFile), "restore-pending.json"), JSON.stringify(pending, null, 2));
  logRestore(opts.liveDbFile, { event: "STAGED", ...pending });
  return pending;
}

/**
 * Recovery of a failed computer: entries it had not synchronised are copied from its last backup into this
 * computer's outbox with their original ids. The authority recognises ids it already executed (Report 21 §3.1),
 * so nothing is posted twice, even if the failed computer managed to sync some of them.
 */
export async function rescuePending(target: PrismaClient, recoveredFile: string, liveKey = process.env.CRM_DB_ENCRYPTION_KEY || "") {
  const rec = createPrismaClient(`file:${recoveredFile.replace(/\\/g, "/")}`, liveKey);
  try {
    // Entries flagged for review stay flagged so someone still sees them; everything else is queued to send
    const rows = await rec.outboxCommand.findMany({ where: { status: { in: ["PENDING_SYNC", "SYNCING", "FAILED_RETRY", "RELAYED", "NEEDS_REVIEW"] }, seq: { gt: 0 } }, orderBy: { seq: "asc" } });
    let added = 0;
    let skipped = 0;
    for (const r of rows) {
      if (await target.outboxCommand.findUnique({ where: { id: r.id } })) {
        skipped++;
        continue;
      }
      const last = await target.outboxCommand.findFirst({ where: { seq: { gt: 0 } }, orderBy: { seq: "desc" }, select: { seq: true } });
      await target.outboxCommand.create({
        data: {
          id: r.id, seq: (last?.seq ?? 0) + 1, type: r.type, payload: r.payload, preview: r.preview, provisionalRef: r.provisionalRef, dependsOn: r.dependsOn,
          officialNumber: r.officialNumber, originDeviceId: r.originDeviceId, createdAt: r.createdAt,
          status: r.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "PENDING_SYNC", result: r.status === "NEEDS_REVIEW" ? r.result : null,
          createdById: r.createdById, lastError: r.status === "NEEDS_REVIEW" ? r.lastError : "Rescued from a failed computer's backup",
        },
      });
      added++;
    }
    return { added, skipped };
  } finally {
    await rec.$disconnect();
  }
}
