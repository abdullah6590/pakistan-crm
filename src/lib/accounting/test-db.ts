// src/lib/accounting/test-db.ts - Throw-away SQLite database built from the committed migrations (tests only).
// Never points at dev.db, test.db or any production file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { ensureAccountingSetup } from "./setup";

const MIGRATIONS = path.resolve(__dirname, "../../../prisma/migrations");

function statements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export async function createTestDb(): Promise<{ db: PrismaClient; file: string; dir: string; cleanup: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-accounting-test-"));
  const file = path.join(dir, "accounting.db").replace(/\\/g, "/");
  const db = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${file}` }) });
  const folders = fs.readdirSync(MIGRATIONS).filter((f) => fs.statSync(path.join(MIGRATIONS, f)).isDirectory()).sort();
  for (const f of folders) {
    for (const stmt of statements(fs.readFileSync(path.join(MIGRATIONS, f, "migration.sql"), "utf8"))) await db.$executeRawUnsafe(stmt);
  }
  await ensureAccountingSetup(db);
  return {
    db,
    file,
    dir,
    cleanup: async () => {
      await db.$disconnect();
      // Windows may hold the SQLite file briefly after disconnect; a leftover temp folder is harmless
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {}
    },
  };
}
