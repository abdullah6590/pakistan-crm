// src/lib/tenancy/migrate.ts - Apply the committed Prisma migrations to a tenant, hub or device database.
// Writes the same `_prisma_migrations` history that `prisma migrate deploy` writes, so `prisma migrate status`
// works on every database. Each migration runs in its own transaction; a failure stops at that migration.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient, type Client } from "@libsql/client";

export const MIGRATIONS_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "prisma", "migrations");

const HISTORY_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL,
  "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`;

/**
 * A migration's checksum is taken over its text with Windows line endings turned into Unix ones: Git on Windows may
 * check the same file out either way (core.autocrlf), and that must not count as a change. `rawChecksum` (the file as
 * it is on disk) is still accepted for any database that recorded it.
 */
export function listMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string; checksum: string; rawChecksum: string }[] {
  return fs.readdirSync(/* turbopackIgnore: true */ dir)
    .filter((f) => fs.statSync(/* turbopackIgnore: true */ path.join(dir, f)).isDirectory())
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(/* turbopackIgnore: true */ path.join(dir, name, "migration.sql"), "utf8");
      const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
      return { name, sql, checksum: sha(sql.replace(/\r\n/g, "\n")), rawChecksum: sha(sql) };
    });
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Bring a database up to date. Refuses to continue if an applied migration's file has since changed. */
export async function applyMigrations(target: string | Client, opts: { encryptionKey?: string; dir?: string } = {}): Promise<MigrationResult> {
  const client = typeof target === "string" ? createClient({ url: target, encryptionKey: opts.encryptionKey }) : target;
  try {
    await client.execute(HISTORY_TABLE);
    const done = new Map((await client.execute(`SELECT "migration_name", "checksum" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`)).rows
      .map((r) => [String(r.migration_name), String(r.checksum)]));
    const result: MigrationResult = { applied: [], alreadyApplied: [] };
    for (const m of listMigrations(opts.dir)) {
      const previous = done.get(m.name);
      if (previous !== undefined) {
        if (previous !== m.checksum && previous !== m.rawChecksum) throw new Error(`Migration ${m.name} was changed after it was applied; refusing to continue`);
        result.alreadyApplied.push(m.name);
        continue;
      }
      const id = crypto.randomUUID();
      await client.executeMultiple(`BEGIN;\n${m.sql}\n;INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ('${id}','${m.checksum}',current_timestamp,'${m.name}',current_timestamp,1);\nCOMMIT;`)
        .catch(async (e) => {
          await client.execute("ROLLBACK").catch(() => undefined);
          throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`);
        });
      result.applied.push(m.name);
    }
    return result;
  } finally {
    if (typeof target === "string") client.close();
  }
}

/** Durability settings for a local database: WAL journal and full sync on commit (Report 20 §1.5). */
export async function hardenLocalDatabase(client: Client): Promise<void> {
  await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA synchronous=FULL");
  await client.execute("PRAGMA foreign_keys=ON");
}
