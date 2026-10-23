// src/lib/backup/runtime.ts - Backups on this node: settings, passphrase, schedule (Report 22 §4-§6).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { nodeRole, tenancyMode, DEFAULT_TENANT_ID } from "@/lib/tenancy/config";
import { getSetting } from "@/lib/accounting/setup";
import { protectSecret, unprotectSecret, dpapiAvailable } from "@/lib/device/secrets";
import { BackupError, applyRetention, changeMarker, createBackup, dbFileFromUrl, dueBackups } from "./service";
import { queueUpload, processUploads, pruneRemote, listRemoteBackups, downloadRemote } from "./drive";
import { prepareRecovery, stageReplace, readPlan, rescuePending, discardRecovery } from "./restore";
import { recoveryRoot, logRestore, pendingRestore, readRestoreLog } from "./restore-apply";
import { isAuthority } from "@/lib/sync/local";
import type { BackupManifest } from "./format";

export async function backupSettings() {
  return (await prisma.backupSettings.findUnique({ where: { id: "local" } })) ?? (await prisma.backupSettings.create({ data: { id: "local" } }));
}

/** This node's history folder: the server's own, an office server's, or one per desktop (kept separate). */
export function scope(): string {
  const role = nodeRole();
  if (role === "cloud") return "server";
  return `${role}-${process.env.CRM_DEVICE_CODE ?? "unregistered"}`;
}

function appVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function passphrase(protectedValue: string | null): Promise<string> {
  if (protectedValue) return unprotectSecret(protectedValue);
  if (process.env.CRM_BACKUP_PASSPHRASE) return process.env.CRM_BACKUP_PASSPHRASE;
  throw new BackupError("Set a backup passphrase first");
}

/** Store the passphrase protected for this Windows account (servers use CRM_BACKUP_PASSPHRASE instead). */
export async function protectPassphrase(value: string): Promise<string> {
  if (value.length < 12) throw new BackupError("The backup passphrase must be at least 12 characters");
  if (!dpapiAvailable()) throw new BackupError("On this server set the passphrase in CRM_BACKUP_PASSPHRASE (secret store)");
  return protectSecret(value);
}

export async function runBackup(type: BackupManifest["type"], trigger: string) {
  if (tenancyMode() === "multi") throw new BackupError("Multi-tenant servers back up each business through the platform backup job (Report 22 §7)");
  const s = await backupSettings();
  if (!s.directory) throw new BackupError("Choose a backup folder first");
  const name = (await getSetting(prisma, "BUSINESS_NAME")) || "Business";
  const result = await createBackup(
    { db: prisma, dbFile: dbFileFromUrl(process.env.DATABASE_URL || "file:./dev.db"), dbKey: process.env.CRM_DB_ENCRYPTION_KEY || undefined, tenant: { id: process.env.CRM_TENANT_ID || DEFAULT_TENANT_ID, name }, scope: scope(), appVersion: appVersion() },
    { directory: s.directory, passphrase: await passphrase(s.protectedPassphrase), type, trigger, changeMarker: await changeMarker(prisma) },
  );
  // Google Drive (Phase 7): queue the verified package; uploads run in the background and resume after failures
  if (await queueUpload(prisma, result.backupId, type)) void uploadsNow();
  await applyRetention(prisma, { keepDaily: s.keepDaily, keepFrequent: s.keepFrequent });
  return result;
}

/** Labels that keep each business's and each computer's backups apart on Google Drive. */
export function driveLabel() {
  return { tenantId: process.env.CRM_TENANT_ID || DEFAULT_TENANT_ID, scope: scope() };
}

let uploading = false;
/** Upload queued backups now (also called by the scheduler); one pass at a time. */
export async function uploadsNow(now = new Date(), opts: { retryNow?: boolean } = {}) {
  if (uploading) return null;
  uploading = true;
  try {
    // "Upload now" (the button) does not wait for the retry timer of earlier failures (D-017)
    if (opts.retryNow) await prisma.backupRun.updateMany({ where: { status: "VERIFIED", uploadStatus: "FAILED" }, data: { uploadNextAt: now } });
    const conn = await prisma.driveConnection.findUnique({ where: { id: "local" } });
    const summary = await processUploads(prisma, driveLabel(), now);
    if (conn?.status === "CONNECTED" && summary.uploaded > 0) await pruneRemote(prisma, driveLabel(), conn.keepRemote).catch(() => undefined);
    return summary;
  } finally {
    uploading = false;
  }
}

const state = globalThis as unknown as { crmBackup?: { running: boolean; timer?: NodeJS.Timeout; startup: boolean } };
state.crmBackup ??= { running: false, startup: true };

/** One scheduling check; the first check after start-up catches up a daily backup missed while the PC was off. */
export async function backupTick(now = new Date()) {
  const st = state.crmBackup!;
  if (st.running) return null;
  st.running = true;
  // Only the very first check after the application starts counts as "at start-up"
  const startup = st.startup;
  st.startup = false;
  try {
    const s = await backupSettings();
    if (!s.enabled || !s.directory) {
      await uploadsNow(now); // manual backups may still be waiting for Google Drive
      return null;
    }
    const lastDaily = await prisma.backupRun.findFirst({ where: { type: "DAILY", status: { in: ["VERIFIED", "DELETED"] } }, orderBy: { startedAt: "desc" } });
    const lastAny = await prisma.backupRun.findFirst({ where: { status: { in: ["VERIFIED", "DELETED"] } }, orderBy: { startedAt: "desc" } });
    const due = dueBackups(now, s, { daily: lastDaily?.startedAt, any: lastAny?.startedAt, anySeq: lastAny?.changeSeq }, await changeMarker(prisma));
    if (due.daily) return await runBackup("DAILY", due.missed || startup ? "MISSED_AT_STARTUP" : "SCHEDULE");
    if (due.frequent) return await runBackup("FREQUENT", "SCHEDULE");
    await uploadsNow(now); // retry queued Google Drive uploads (e.g. after the internet returns)
    return null;
  } catch {
    return null; // the failure is recorded on the backup run and shown on the Backups screen
  } finally {
    st.running = false;
  }
}

export function startBackupLoop() {
  if (tenancyMode() === "multi" || state.crmBackup!.timer) return;
  state.crmBackup!.timer = setInterval(() => void backupTick(), 60_000);
  setTimeout(() => void backupTick(), 5_000);
}

/** Windows folder picker on the computer running this application (desktop or office server). */
export function pickFolder(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.reject(new BackupError("The folder picker is available on Windows computers only"));
  const script = `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose the folder for Pakistan CRM backups (a different drive or a USB/external disk is best)'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }`;
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: false });
    let out = "";
    ps.stdout.on("data", (d) => (out += d));
    ps.on("error", (e) => reject(new BackupError(e.message)));
    ps.on("close", () => resolve(out.trim() || null));
  });
}

/** The chosen folder must exist and accept a test file. */
export function checkFolder(dir: string) {
  if (!path.isAbsolute(dir)) throw new BackupError("Choose a full folder path");
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new BackupError("That folder does not exist");
  const probe = path.join(dir, `.crm-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
  } catch {
    throw new BackupError("This folder cannot be written to");
  }
}

/** Status shown on the Backups screen and returned by GET /api/backups. */
export async function backupStatus() {
  const s = await backupSettings();
  const runs = await prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 100 });
  const lastOk = runs.find((r) => r.status === "VERIFIED");
  return {
    scope: scope(),
    settings: { enabled: s.enabled, directory: s.directory, dailyTime: s.dailyTime, frequentMinutes: s.frequentMinutes, keepDaily: s.keepDaily, keepFrequent: s.keepFrequent, passphraseSet: !!s.protectedPassphrase || !!process.env.CRM_BACKUP_PASSPHRASE },
    lastSuccess: lastOk ? { at: (lastOk.finishedAt ?? lastOk.startedAt).toISOString(), file: lastOk.file ?? "", sizeBytes: lastOk.sizeBytes ?? 0, type: lastOk.type } : null,
    lastError: runs[0]?.status === "FAILED" ? { at: (runs[0].finishedAt ?? runs[0].startedAt).toISOString(), error: runs[0].error ?? "" } : null,
    runs: runs.map((r) => ({ id: r.id, type: r.type, status: r.status, trigger: r.trigger, file: r.file, sizeBytes: r.sizeBytes, error: r.error, startedAt: r.startedAt.toISOString(), uploadStatus: r.uploadStatus, uploadError: r.uploadError })),
  };
}

/** Google Drive status for the Backups screen and GET /api/drive. */
export async function driveStatus() {
  const { driveConfig } = await import("./drive");
  const conn = await prisma.driveConnection.findUnique({ where: { id: "local" } });
  const last = await prisma.backupRun.findFirst({ where: { uploadStatus: "UPLOADED" }, orderBy: { uploadedAt: "desc" } });
  const waiting = await prisma.backupRun.count({ where: { status: "VERIFIED", uploadStatus: { in: ["QUEUED", "FAILED", "UPLOADING"] } } });
  return {
    configured: !!driveConfig(),
    status: conn?.status ?? "NOT_CONNECTED",
    accountEmail: conn?.accountEmail ?? null,
    folderName: conn?.folderName ?? null,
    folderSet: !!conn?.folderId,
    uploadFrequent: conn?.uploadFrequent ?? false,
    keepRemote: conn?.keepRemote ?? 30,
    lastError: conn?.lastError ?? null,
    storage: conn?.quotaBytes ? { limit: conn.quotaBytes, used: conn.usedBytes ?? "0" } : null,
    lastUpload: last?.uploadedAt ? { at: last.uploadedAt.toISOString(), fileId: last.uploadRef } : null,
    waiting,
  };
}

// ─── Restore and disaster recovery (Report 23) ────────────────────
const liveDbFile = () => dbFileFromUrl(process.env.DATABASE_URL || "file:./dev.db");
const tenantId = () => process.env.CRM_TENANT_ID || DEFAULT_TENANT_ID;

async function restoreAudit(action: string, userId: string, after: Record<string, unknown>) {
  // On a replica the audit trail belongs to the cloud; the restore log beside the database records it there
  if (isAuthority()) await prisma.auditLog.create({ data: { entity: "Database", entityId: String(after.backupId ?? after.recoveryId ?? "local"), action, userId, after: JSON.stringify(after) } });
}

/** Backups that can be restored here: this computer's, and this business's on Google Drive (from any computer). */
export async function restoreSources() {
  const runs = await prisma.backupRun.findMany({ where: { status: "VERIFIED" }, orderBy: { startedAt: "desc" }, take: 100 });
  const local = runs.filter((r) => r.file && fs.existsSync(r.file)).map((r) => ({ backupId: r.id, type: r.type, at: r.startedAt.toISOString(), file: r.file!, sizeBytes: r.sizeBytes }));
  let remote: Awaited<ReturnType<typeof listRemoteBackups>> = [];
  let remoteError: string | null = null;
  const conn = await prisma.driveConnection.findUnique({ where: { id: "local" } });
  if (conn?.status === "CONNECTED") {
    try {
      remote = await listRemoteBackups(prisma, tenantId());
    } catch (e) {
      remoteError = (e as Error).message;
    }
  }
  return { local, remote, remoteError, pending: pendingRestore(liveDbFile()), log: readRestoreLog(liveDbFile()).slice(-20).reverse() };
}

/** Validate a backup and recover it into an isolated copy; nothing live changes. */
export async function prepareRestore(input: { backupId?: string; driveFileId?: string; file?: string; passphrase?: string }, userId: string) {
  if (tenancyMode() === "multi") throw new BackupError("On a multi-tenant server restore one business with scripts/tenant-admin.ts restore (Report 23 §6)");
  let file: string;
  if (input.backupId) {
    const run = await prisma.backupRun.findUnique({ where: { id: input.backupId } });
    if (!run?.file || run.status !== "VERIFIED" || !fs.existsSync(run.file)) throw new BackupError("That backup file is not available on this computer");
    file = run.file;
  } else if (input.driveFileId) {
    file = path.join(recoveryRoot(liveDbFile()), "downloads", `${crypto.randomUUID()}.pkbk`);
    await downloadRemote(prisma, tenantId(), input.driveFileId, file);
  } else if (input.file) {
    // A package copied from another computer or a USB disk
    file = input.file;
    if (!path.isAbsolute(file) || !file.toLowerCase().endsWith(".pkbk") || !fs.existsSync(/* turbopackIgnore: true */ file)) throw new BackupError("Give the full path of a .pkbk backup file");
  } else {
    throw new BackupError("Choose a backup to restore");
  }
  const s = await backupSettings();
  const pass = input.passphrase || (await passphrase(s.protectedPassphrase));
  const plan = await prepareRecovery({ file, passphrase: pass, tenantId: tenantId(), liveDbFile: liveDbFile(), live: prisma });
  await restoreAudit("RESTORE_PREPARED", userId, { recoveryId: plan.recoveryId, backupId: plan.manifest.backupId, schemaAction: plan.schemaAction });
  return plan;
}

/**
 * Replace the live data with a prepared recovery: the phrase is checked, a verified safety backup of the current
 * data is taken, and the swap is staged for the next start of the application.
 */
export async function confirmRestore(input: { recoveryId: string; confirmation: string }, userId: string) {
  const plan = readPlan(liveDbFile(), input.recoveryId);
  if (input.confirmation.trim() !== plan.confirmationPhrase) throw new BackupError(`Type exactly: ${plan.confirmationPhrase}`);
  if (plan.checks.reconciliationErrors.length) throw new BackupError("The recovered copy has accounting errors; it will not replace the live data");
  const safety = await runBackup("PRE_RESTORE", "BEFORE_RESTORE").catch((e) => {
    throw new BackupError(`The safety backup of the current data failed, so nothing was changed: ${(e as Error).message}`);
  });
  const staged = stageReplace({ liveDbFile: liveDbFile(), recoveryId: input.recoveryId, confirmation: input.confirmation, userId, safetyBackupId: safety.backupId });
  await restoreAudit("RESTORE_STAGED", userId, { ...staged, recoveredFile: undefined });
  return { ...staged, safetyBackupFile: safety.file, restartRequired: true };
}

export async function cancelRestore(userId: string) {
  const pending = pendingRestore(liveDbFile());
  if (!pending) throw new BackupError("No restore is waiting");
  fs.rmSync(path.join(recoveryRoot(liveDbFile()), "restore-pending.json"));
  logRestore(liveDbFile(), { event: "CANCELLED", recoveryId: pending.recoveryId, by: userId });
  await restoreAudit("RESTORE_CANCELLED", userId, { recoveryId: pending.recoveryId, backupId: pending.backupId });
  return pending;
}

/** A failed computer's unsynchronised entries, taken from its recovered backup, are queued here to send. */
export async function rescueFromRecovery(recoveryId: string, userId: string) {
  if (nodeRole() === "cloud") throw new BackupError("Rescuing unsent entries is done on the replacement computer, not on the server");
  const plan = readPlan(liveDbFile(), recoveryId);
  const r = await rescuePending(prisma, plan.recoveredFile);
  logRestore(liveDbFile(), { event: "RESCUED", recoveryId, backupId: plan.manifest.backupId, fromScope: plan.manifest.scope, by: userId, ...r });
  return r;
}

export function discardPreparedRecovery(recoveryId: string) {
  discardRecovery(liveDbFile(), recoveryId);
}
