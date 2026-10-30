// scripts/opening-stock.ts - Bring the stock already on hand into Books, once (Report 28 §6, owner decision 2026-10-24).
// Each active item with a quantity above zero and no stock in Books yet is entered as opening stock at its cost price:
// stock and its value enter Books (Dr stock in hand, Cr opening balances), no income is posted, and the item's count
// on the Inventory screen is left as it is (it already includes this stock).
//
// Usage, on the computer that holds the database, from the project folder:
//   npx tsx scripts/opening-stock.ts                      what would be entered (changes nothing)
//   npx tsx scripts/opening-stock.ts --apply <admin-email>
// The database is DATABASE_URL, or the one named in .env.local. A backup is taken before anything is written.
import fs from "node:fs";
import path from "node:path";
import { createPrismaClient } from "../src/lib/prisma";
import { tenancyMode } from "../src/lib/tenancy/config";
import { ensureAccountingSetup, MAIN_LOCATION } from "../src/lib/accounting/setup";
import crypto from "node:crypto";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error("Set DATABASE_URL, or run this from the project folder (it reads .env.local)");
  return m[1];
}

async function main() {
  // The posting service loads the sign-in module, which needs a secret; this script signs nobody in
  process.env.JWT_SECRET ||= crypto.randomBytes(32).toString("hex");
  const { createOpeningStock, withoutItemCountChange } = await import("../src/lib/accounting/posting");
  const args = process.argv.slice(2);
  const apply = args[0] === "--apply";
  if (tenancyMode() === "multi") throw new Error("Run this per business on a single-business database");
  if ((process.env.CRM_NODE_ROLE ?? "cloud") !== "cloud") throw new Error("Run this on the main server; stock reaches desktops by sync");
  const url = databaseUrl();
  if (!url.startsWith("file:")) throw new Error("Only a database file on this computer can be used");
  const file = path.resolve(url.slice(5).replace(/^\/\/(?=[A-Za-z]:)/, ""));
  if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
  const base = path.basename(file).toLowerCase();
  if (base === "dev.db" || base === "test.db") throw new Error(`${base} is protected evidence and is never changed`);
  const db = createPrismaClient(`file:${file.replace(/\\/g, "/")}`);
  try {
    const migrated = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM _prisma_migrations WHERE migration_name = '20261024100000_payment_allocations' AND finished_at IS NOT NULL`);
    if (!Number(migrated[0]?.n)) throw new Error("This database is not up to date yet: start the app once (it brings the database up to date), then run this again");
    await ensureAccountingSetup(db);
    const main = await db.stockLocation.findUniqueOrThrow({ where: { code: MAIN_LOCATION } });
    const items = await db.component.findMany({ where: { isActive: true, quantity: { gt: 0 } }, orderBy: { name: "asc" } });
    const lines: { componentId: string; name: string; quantity: number; unitCost: number }[] = [];
    const unresolved: string[] = [];
    for (const c of items) {
      const inBooks = await db.stockMovement.count({ where: { componentId: c.id } });
      const balance = await db.itemStockBalance.findUnique({ where: { componentId_locationId: { componentId: c.id, locationId: main.id } } });
      if (inBooks > 0 || (balance && Number(balance.onHand) !== 0)) continue; // already in Books
      // Never at zero or a guessed cost (owner instruction 2026-10-26); a cost per package needs the unit chosen on screen
      if (!(c.unitCost > 0)) unresolved.push(`${c.name}: ${c.quantity} on hand, no cost price: unresolved until the real cost is entered`);
      else if (c.itemsPerPackage > 1) unresolved.push(`${c.name}: ${c.quantity} on hand, cost Rs ${c.unitCost} per ${c.packagingUnit}: enter it on Inventory → Opening stock, where the unit is chosen`);
      else lines.push({ componentId: c.id, name: c.name, quantity: c.quantity, unitCost: c.unitCost });
    }
    const total = lines.reduce((t, l) => t + l.quantity * l.unitCost, 0);
    console.log(`${path.basename(file)}: ${lines.length} item(s) to enter as opening stock, value Rs ${total.toLocaleString("en-PK")}`);
    for (const l of lines) console.log(`  ${l.name}: ${l.quantity} at Rs ${l.unitCost} = Rs ${(l.quantity * l.unitCost).toLocaleString("en-PK")}`);
    if (unresolved.length) console.log(`Not entered (${unresolved.length}):\n  ${unresolved.join("\n  ")}`);
    if (!apply) {
      console.log("Nothing was changed. To enter it: npx tsx scripts/opening-stock.ts --apply <admin-email>");
      return;
    }
    if (lines.length === 0) { console.log("Nothing to enter."); return; }
    const email = (args[1] ?? "").toLowerCase();
    const admin = email ? await db.user.findUnique({ where: { email } }) : null;
    if (!admin || admin.role !== "ADMIN" || !admin.isActive) throw new Error("--apply needs the e-mail of an active administrator of this database");

    // A consistent backup first, so this can always be undone by restoring it
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(path.dirname(file), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${path.basename(file, ".db")}.backup-${stamp}-before-opening-stock.db`);
    await db.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);

    const doc = await withoutItemCountChange(() => createOpeningStock(db, { id: admin.id, role: admin.role }, {
      date: new Date(), lines: lines.map((l) => ({ componentId: l.componentId, quantity: l.quantity, unitCost: l.unitCost })),
      remarks: "Opening stock: items already on hand when Sales moved to Books (Report 28)",
    }));
    console.log(`Entered as ${(doc as { docNo: string }).docNo}. Backup taken first: ${backup}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
