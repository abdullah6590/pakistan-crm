// Test helper (not used by the app): submits offline sales in a loop until killed, printing each committed seq.
// Usage: npx tsx src/lib/sync/crash-child.ts <db file> <user id> <party id> <item id>
import { createPrismaClient } from "../prisma";
import { submitCommand } from "./outbox";

async function main() {
  const [file, userId, partyId, itemId] = process.argv.slice(2);
  const db = createPrismaClient(`file:${file}`, undefined);
  await db.$executeRawUnsafe("PRAGMA synchronous=FULL");
  for (let i = 0; ; i++) {
    const row = await submitCommand(db, { id: "dev-crash", code: "DC" }, {
      type: "CREATE_DOCUMENT", actorUserId: userId, docType: "SALE_INVOICE",
      input: { date: "2026-10-22", partyAccountId: partyId, lines: [{ componentId: itemId, quantity: 1, unitPrice: 10 }] },
    });
    process.stdout.write(`committed ${row.seq}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
