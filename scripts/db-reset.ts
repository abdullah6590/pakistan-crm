// scripts/db-reset.ts - Erase and rebuild a DISPOSABLE development database, then seed it (decision D-4).
// Usage: DATABASE_URL=file:./demo.scratch.db CRM_CONFIRM_RESET=demo.scratch.db npm run db:reset
// Refused in production, on multi-business servers and for any database not named *.scratch.db / *.sandbox.db.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { assertDisposableDatabase } from "../src/lib/dev/reset-guard";
import { applyMigrations } from "../src/lib/tenancy/migrate";

async function main() {
  const file = assertDisposableDatabase(process.env.DATABASE_URL);
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  const r = await applyMigrations(`file:${file.replace(/\\/g, "/")}`);
  console.log(`Rebuilt ${file} (${r.applied.length} migrations)`);
  execFileSync(process.execPath, [...process.execArgv, "prisma/seed.ts"], { stdio: "inherit", env: process.env });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
