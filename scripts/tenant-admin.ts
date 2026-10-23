// scripts/tenant-admin.ts - Platform provisioning for multi-tenant mode (Report 25).
// Usage (environment: CRM_TENANCY=multi, CONTROL_DATABASE_URL, TENANT_DB_DIR):
//   npx tsx scripts/tenant-admin.ts create <slug> "<Business name>" <owner-email> "<Owner name>"
//   npx tsx scripts/tenant-admin.ts list
//   npx tsx scripts/tenant-admin.ts migrate-all
//   npx tsx scripts/tenant-admin.ts backup-all <folder>                       (platform backup job, Report 23 §6)
//   npx tsx scripts/tenant-admin.ts restore-prepare <slug> <file.pkbk>         (validates; nothing live changes)
//   npx tsx scripts/tenant-admin.ts restore-apply <slug> <recoveryId> "<phrase>" <safety-folder>
// Backup passphrase: TENANT_BACKUP_PASSPHRASE. restore-apply needs the application server stopped (or that business's
// database otherwise closed); it suspends the business, takes a verified safety backup, swaps, then reactivates.
// The owner's initial password is read from the environment variable TENANT_OWNER_PASSWORD, never from the
// command line (so it does not land in shell history). Nothing here deletes a tenant or its database.
import { execFileSync } from "node:child_process";
import { hash } from "bcryptjs";
import { createClient } from "@libsql/client";
import { applyMigrations } from "../src/lib/tenancy/migrate";
import { tenancyMode } from "../src/lib/tenancy/config";
import { registerTenant, listTenants, getTenantBySlug, setTenantStatus, Tenant } from "../src/lib/tenancy/registry";
import { createPrismaClient } from "../src/lib/prisma";
import { createBackup, applyRetention, dbFileFromUrl } from "../src/lib/backup/service";
import { prepareRecovery, readPlan, stageReplace, applyPendingRestore } from "../src/lib/backup/restore";

function backupPassphrase() {
  const p = process.env.TENANT_BACKUP_PASSPHRASE;
  if (!p || p.length < 12) throw new Error("Set TENANT_BACKUP_PASSPHRASE (at least 12 characters)");
  return p;
}

async function backupTenant(t: Tenant, directory: string, type: "DAILY" | "PRE_RESTORE", trigger: string) {
  const db = createPrismaClient(t.dbUrl, "");
  try {
    const r = await createBackup({ db, dbFile: dbFileFromUrl(t.dbUrl), tenant: { id: t.id, name: t.name }, scope: "server", appVersion: "platform" }, { directory, passphrase: backupPassphrase(), type, trigger });
    if (type === "DAILY") await applyRetention(db, { keepDaily: 30, keepFrequent: 0 });
    return r;
  } finally {
    await db.$disconnect();
  }
}

async function tenantOrFail(slug: string) {
  const t = await getTenantBySlug(slug);
  if (!t) throw new Error(`No business with slug ${slug}`);
  return t;
}

async function main() {
  if (tenancyMode() !== "multi") throw new Error("Set CRM_TENANCY=multi to manage tenants");
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "create") {
    const [slug, name, email, ownerName] = args;
    const password = process.env.TENANT_OWNER_PASSWORD;
    if (!slug || !name || !email || !ownerName) throw new Error('create <slug> "<name>" <owner-email> "<owner name>"');
    if (!password || password.length < 10) throw new Error("Set TENANT_OWNER_PASSWORD (at least 10 characters)");
    const tenant = await registerTenant({ slug, name });
    const migrated = await applyMigrations(tenant.dbUrl);
    const db = createClient({ url: tenant.dbUrl });
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO users (id, name, email, password, role, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'ADMIN', 1, ?, ?)`,
      args: [`u_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`, ownerName, email.toLowerCase(), await hash(password, 12), now, now],
    });
    db.close();
    console.log(JSON.stringify({ tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, migrations: migrated.applied.length, owner: email }));
  } else if (cmd === "list") {
    console.log(JSON.stringify((await listTenants()).map((t) => ({ id: t.id, slug: t.slug, name: t.name, status: t.status }))));
  } else if (cmd === "migrate-all") {
    for (const t of await listTenants()) {
      const r = await applyMigrations(t.dbUrl);
      console.log(`${t.slug}: applied ${r.applied.length}, already ${r.alreadyApplied.length}`);
    }
  } else if (cmd === "backup-all") {
    const [dir] = args;
    if (!dir) throw new Error("backup-all <folder>");
    let failed = 0;
    for (const t of await listTenants()) {
      if (t.status === "CLOSED") continue;
      try {
        const r = await backupTenant(t, dir, "DAILY", "PLATFORM");
        console.log(`${t.slug}: VERIFIED ${r.file}`);
      } catch (e) {
        failed++;
        console.log(`${t.slug}: FAILED ${(e as Error).message}`);
      }
    }
    if (failed) process.exitCode = 2;
  } else if (cmd === "restore-prepare") {
    const [slug, file] = args;
    if (!slug || !file) throw new Error("restore-prepare <slug> <file.pkbk>");
    const t = await tenantOrFail(slug);
    const live = createPrismaClient(t.dbUrl, "");
    try {
      const plan = await prepareRecovery({ file, passphrase: backupPassphrase(), tenantId: t.id, liveDbFile: dbFileFromUrl(t.dbUrl), live, liveKey: "" });
      console.log(JSON.stringify({ recoveryId: plan.recoveryId, backup: { id: plan.manifest.backupId, createdAt: plan.manifest.createdAt }, schemaAction: plan.schemaAction, checks: plan.checks, covered: plan.covered, current: plan.current, wouldLose: plan.wouldLose, confirmationPhrase: plan.confirmationPhrase }, null, 2));
    } finally {
      await live.$disconnect();
    }
  } else if (cmd === "restore-apply") {
    const [slug, recoveryId, phrase, safetyDir] = args;
    if (!slug || !recoveryId || !phrase || !safetyDir) throw new Error('restore-apply <slug> <recoveryId> "<phrase>" <safety-folder>');
    const t = await tenantOrFail(slug);
    const dbFile = dbFileFromUrl(t.dbUrl);
    const plan = readPlan(dbFile, recoveryId);
    if (phrase.trim() !== plan.confirmationPhrase) throw new Error(`Type exactly: ${plan.confirmationPhrase}`);
    const before = t.status;
    await setTenantStatus(t.id, "SUSPENDED");
    try {
      // The safety backup and the swap each run in a fresh process: Windows keeps a database file locked by any
      // process that has opened it, so this process never opens the business's database
      const child = (...a: string[]) => execFileSync(process.execPath, [...process.execArgv, process.argv[1], ...a], { env: process.env }).toString().trim().split("\n").pop() || "null";
      const safety = JSON.parse(child("backup-one", slug, safetyDir)) as { backupId: string; file: string };
      stageReplace({ liveDbFile: dbFile, recoveryId, confirmation: phrase, userId: "platform-operator", safetyBackupId: safety.backupId });
      const result = JSON.parse(child("restore-swap", slug));
      console.log(JSON.stringify({ ...result, safetyBackup: safety.file }, null, 2));
      if (result?.event !== "APPLIED") process.exitCode = 2;
    } finally {
      await setTenantStatus(t.id, before);
    }
  } else if (cmd === "backup-one") {
    // Internal step of restore-apply: the verified safety backup, in its own process
    const t = await tenantOrFail(args[0] ?? "");
    const r = await backupTenant(t, args[1] ?? "", "PRE_RESTORE", "BEFORE_RESTORE");
    console.log(JSON.stringify({ backupId: r.backupId, file: r.file }));
  } else if (cmd === "restore-swap") {
    // Internal step of restore-apply; never opens the business's database before the swap
    const t = await tenantOrFail(args[0] ?? "");
    console.log(JSON.stringify(await applyPendingRestore(dbFileFromUrl(t.dbUrl), "")));
  } else {
    throw new Error("Commands: create, list, migrate-all, backup-all, restore-prepare, restore-apply");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
