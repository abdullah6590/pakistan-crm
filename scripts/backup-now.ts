// scripts/backup-now.ts - A verified copy of the database, now, before a risky step (independent of the app's own
// encrypted backups). The copy is consistent (VACUUM INTO) and is checked: integrity "ok" and every table's row
// count equal to the live database. A second copy can go to another disk.
//   npx tsx scripts/backup-now.ts <label> [second-folder]
// e.g. npx tsx scripts/backup-now.ts before-sales-on-books C:\PakistanCRM-Backups\manual
// The database is DATABASE_URL, or the one named in .env.local.
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

function databaseFile(): string {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const env = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
    url = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
  }
  if (!url?.startsWith("file:")) throw new Error("Set DATABASE_URL to a database file, or run this from the project folder");
  const file = path.resolve(url.slice(5).replace(/^\/\/(?=[A-Za-z]:)/, ""));
  if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
  return file;
}

const open = (file: string) => createClient({ url: `file:${file.replace(/\\/g, "/")}`, encryptionKey: process.env.CRM_DB_ENCRYPTION_KEY || undefined });

async function counts(c: Client) {
  const tables = (await c.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await c.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  return out;
}

async function verify(file: string, expected: Record<string, number>) {
  const c = open(file);
  try {
    const ok = String(Object.values((await c.execute("PRAGMA integrity_check")).rows[0])[0]);
    const got = await counts(c);
    const diff = Object.keys(expected).filter((t) => expected[t] !== got[t]);
    if (ok !== "ok" || diff.length) throw new Error(`${file} did not verify: integrity ${ok}${diff.length ? `; different: ${diff.join(", ")}` : ""}`);
    return Object.values(got).reduce((a, b) => a + b, 0);
  } finally {
    c.close();
  }
}

async function main() {
  const [label = "manual", second] = process.argv.slice(2);
  if (!/^[A-Za-z0-9-]+$/.test(label)) throw new Error("The label may use letters, digits and dashes only");
  const file = databaseFile();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${path.basename(file, ".db")}.backup-${stamp}-${label}.db`;
  const dir = path.join(path.dirname(file), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);

  const live = open(file);
  let expected: Record<string, number>;
  try {
    expected = await counts(live);
    await live.execute({ sql: "VACUUM INTO ?", args: [target] });
  } finally {
    live.close();
  }
  const rows = await verify(target, expected);
  console.log(`Backup verified (integrity ok, ${Object.keys(expected).length} tables, ${rows} rows, same as live): ${target}`);
  if (second) {
    fs.mkdirSync(second, { recursive: true });
    const copy = path.join(second, name);
    fs.copyFileSync(target, copy);
    await verify(copy, expected);
    console.log(`Second copy verified: ${copy}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
