// scripts/migrate-db.ts - Bring a database file up to date with prisma/migrations, safely and on purpose.
//   npx tsx scripts/migrate-db.ts            what is pending (changes nothing)
//   npx tsx scripts/migrate-db.ts --apply    back up, verify the backup, rehearse on a copy of it, then update
// Steps of --apply, stopping at the first problem with the live database untouched:
//   1. a consistent backup (VACUUM INTO) in <db folder>/backups, checked: integrity "ok" and every table's row count
//      equal to the live database;
//   2. the pending migrations rehearsed on a copy of that backup (integrity "ok" afterwards);
//   3. the same migrations applied to the live database, then integrity and row counts checked again.
// The database is DATABASE_URL, or the one named in .env.local. dev.db and test.db are refused (protected evidence).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { applyMigrations, listMigrations } from "../src/lib/tenancy/migrate";

function databaseFile(): string {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const env = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
    url = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
  }
  if (!url) throw new Error("Set DATABASE_URL, or run this from the project folder (it reads .env.local)");
  if (!url.startsWith("file:")) throw new Error("Only a database file on this computer can be updated with this tool");
  const file = path.resolve(url.slice(5).replace(/^\/\/(?=[A-Za-z]:)/, ""));
  if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
  if (["dev.db", "test.db"].includes(path.basename(file).toLowerCase())) throw new Error(`${path.basename(file)} is protected evidence and is never changed`);
  return file;
}

const open = (file: string) => createClient({ url: `file:${file.replace(/\\/g, "/")}`, encryptionKey: process.env.CRM_DB_ENCRYPTION_KEY || undefined });

async function integrity(c: Client) {
  return String((await c.execute("PRAGMA integrity_check")).rows[0]?.[0] ?? (await c.execute("PRAGMA integrity_check")).rows[0]?.integrity_check);
}

async function counts(c: Client) {
  const tables = (await c.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await c.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  return out;
}

async function pending(c: Client) {
  const hasHistory = (await c.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'`)).rows.length > 0;
  const done = hasHistory ? new Set((await c.execute(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).rows.map((r) => String(r.migration_name))) : new Set<string>();
  return listMigrations().filter((m) => !done.has(m.name)).map((m) => m.name);
}

/** Tables an update may add rows to, never remove: the migration history and the sync log (an update can queue
 *  existing records for computers to fetch, Report 30). */
const MAY_GROW = new Set(["_prisma_migrations", "change_log"]);

function sameCounts(a: Record<string, number>, b: Record<string, number>) {
  // Every other table must keep exactly the rows it had
  return Object.keys(a)
    .filter((t) => (MAY_GROW.has(t) ? (b[t] ?? -1) < a[t] : a[t] !== b[t]))
    .map((t) => `${t}: ${a[t]} → ${b[t] ?? "missing"}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const file = databaseFile();
  const live = open(file);
  try {
    const todo = await pending(live);
    console.log(`${path.basename(file)}: ${todo.length} update(s) pending${todo.length ? `: ${todo.join(", ")}` : ""}`);
    if (!apply || todo.length === 0) {
      if (todo.length) console.log("Nothing was changed. To apply: npx tsx scripts/migrate-db.ts --apply (close the app first)");
      return;
    }
    const before = await counts(live);
    const ok = await integrity(live);
    if (ok !== "ok") throw new Error(`The database fails its integrity check (${ok}); nothing was changed`);

    // 1. Backup, verified
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(path.dirname(file), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `${path.basename(file, ".db")}.backup-${stamp}-before-update.db`);
    await live.execute({ sql: "VACUUM INTO ?", args: [backup] });
    const b = open(backup);
    const bOk = await integrity(b);
    const bDiff = sameCounts(before, await counts(b));
    b.close();
    if (bOk !== "ok" || bDiff.length) throw new Error(`The backup did not verify (${bOk}; ${bDiff.join("; ")}); nothing was changed`);
    console.log(`1. Backup taken and verified (integrity ok, ${Object.keys(before).length} tables, same row counts): ${backup}`);

    // 2. Rehearsal on a copy of the backup
    const rehearsal = path.join(os.tmpdir(), `crm-update-rehearsal-${process.pid}.db`);
    fs.copyFileSync(backup, rehearsal);
    const r = open(rehearsal);
    try {
      const done = await applyMigrations(r);
      const rOk = await integrity(r);
      const rDiff = sameCounts(before, await counts(r));
      if (rOk !== "ok" || rDiff.length) throw new Error(`The rehearsal failed (${rOk}; ${rDiff.join("; ")}); nothing was changed`);
      console.log(`2. Rehearsed on a copy of the backup: ${done.applied.length} update(s) applied, integrity ok, existing rows unchanged`);
    } finally {
      r.close();
      // Windows keeps the file locked until this process ends (libsql); the copy is in the temp folder, so a failed
      // clean-up is harmless and must not stop the update
      try { fs.rmSync(rehearsal, { force: true }); } catch { /* left in the temp folder */ }
    }

    // 3. The live database
    const done = await applyMigrations(live);
    const after = await counts(live);
    const aOk = await integrity(live);
    const aDiff = sameCounts(before, after);
    if (aOk !== "ok" || aDiff.length) throw new Error(`After the update: ${aOk}; ${aDiff.join("; ")}. Restore the backup: ${backup}`);
    const added = Object.keys(after).filter((t) => !(t in before));
    console.log(`3. ${path.basename(file)} updated: ${done.applied.join(", ")}; integrity ok; existing rows unchanged${added.length ? `; new tables: ${added.join(", ")}` : ""}`);
  } finally {
    live.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
