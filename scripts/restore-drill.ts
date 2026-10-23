// scripts/restore-drill.ts - Restore drill (Report 25 R-1): restore a backup into a SEPARATE recovery copy, check it,
// compare it with the working database, then remove the copy. The working database is only read, never replaced.
// Usage: DATABASE_URL=file:./crm.db npx tsx scripts/restore-drill.ts [backup.pkbk] [--keep]
// Passphrase: the one saved on this computer by Books -> Backups (Windows-protected), or CRM_BACKUP_PASSPHRASE.
// Without a file argument the newest verified backup recorded in the database is used.
import fs from "node:fs";
import path from "node:path";
import { createPrismaClient } from "../src/lib/prisma";
import { DEFAULT_TENANT_ID } from "../src/lib/tenancy/config";
import { unprotectSecret } from "../src/lib/device/secrets";
import { dbFileFromUrl, removeWorkDir } from "../src/lib/backup/service";
import { prepareRecovery } from "../src/lib/backup/restore";
import { reconcileCentral, documentTotals } from "../src/lib/sync/reconcile";

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const fileArg = args.find((a) => !a.startsWith("--"));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the working database");
  const live = createPrismaClient(url);
  try {
    const settings = await live.backupSettings.findUnique({ where: { id: "local" } });
    const passphrase = process.env.CRM_BACKUP_PASSPHRASE || (settings?.protectedPassphrase ? await unprotectSecret(settings.protectedPassphrase) : "");
    if (!passphrase) throw new Error("No backup passphrase: set it in Books -> Backups first");
    const file = fileArg ?? (await live.backupRun.findFirst({ where: { status: "VERIFIED" }, orderBy: { startedAt: "desc" } }))?.file;
    if (!file || !fs.existsSync(file)) throw new Error("No verified backup file found; click Back up now first");

    // The recovery copy goes in its own folder beside the working database, never over it
    const drillBase = path.join(path.dirname(dbFileFromUrl(url)), "restore-drill", path.basename(dbFileFromUrl(url)));
    fs.mkdirSync(path.dirname(drillBase), { recursive: true });
    const plan = await prepareRecovery({ file, passphrase, tenantId: process.env.CRM_TENANT_ID || DEFAULT_TENANT_ID, liveDbFile: drillBase, live });
    const rec = createPrismaClient(`file:${plan.recoveredFile.replace(/\\/g, "/")}`);
    const [recTotals, liveTotals, recCheck] = await Promise.all([documentTotals(rec), documentTotals(live), reconcileCentral(rec)]);
    await rec.$disconnect();
    const sameAsWorking = JSON.stringify(recTotals) === JSON.stringify(liveTotals) && JSON.stringify(plan.covered) === JSON.stringify(plan.current);
    console.log(JSON.stringify({
      backup: { file, id: plan.manifest.backupId, createdAt: plan.manifest.createdAt, type: plan.manifest.type, sizeBytes: fs.statSync(file).size },
      checks: { integrity: plan.checks.integrity, countsMatchManifest: plan.checks.countsMatch, accountingErrors: recCheck.findings.filter((f) => f.severity === "ERROR").length, schema: plan.schemaAction },
      records: { inBackup: plan.covered, inWorkingDatabase: plan.current },
      identicalToWorkingDatabase: sameAsWorking,
      recoveredCopy: keep ? plan.recoveredFile : "removed after the check",
    }, null, 2));
    if (!keep) removeWorkDir(path.dirname(plan.recoveredFile));
    if (plan.checks.integrity !== "ok" || recCheck.findings.some((f) => f.severity === "ERROR")) process.exitCode = 2;
  } finally {
    await live.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
