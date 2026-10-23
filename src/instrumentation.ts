// src/instrumentation.ts - Runs once when the server starts. Devices and hubs start their background sync loop.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const single = (process.env.CRM_TENANCY ?? "single").toLowerCase() !== "multi";
  // A restore an administrator confirmed is applied first, before anything opens the database (Report 23 §3)
  const url = process.env.DATABASE_URL ?? "";
  if (single && url.startsWith("file:")) {
    const { applyPendingRestore } = await import("./lib/backup/restore-apply");
    const { dbFileFromUrl } = await import("./lib/backup/service");
    const result = await applyPendingRestore(dbFileFromUrl(url));
    if (result) console.log(`[restore] ${result.event}${result.error ? `: ${result.error}` : ""}`);
    // The desktop app brings its own database up to this version before serving (additive migrations only; a
    // changed or failing migration stops the start instead of serving a half-migrated database)
    if (process.env.CRM_AUTO_MIGRATE === "1") {
      const { applyMigrations } = await import("./lib/tenancy/migrate");
      const migrated = await applyMigrations(url, { encryptionKey: process.env.CRM_DB_ENCRYPTION_KEY || undefined });
      if (migrated.applied.length) console.log(`[migrate] applied ${migrated.applied.length} migration(s)`);
    }
  }
  const role = (process.env.CRM_NODE_ROLE ?? "cloud").toLowerCase();
  if (role === "device" || role === "hub") {
    const { startSyncLoop } = await import("./lib/sync/scheduler");
    startSyncLoop();
  }
  // Automatic local backups (all single-business nodes; a multi-tenant cloud uses the platform job)
  if (single) {
    const { startBackupLoop } = await import("./lib/backup/runtime");
    startBackupLoop();
  }
}
