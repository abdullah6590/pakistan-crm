// src/lib/sync/replica.ts - Apply the authority's changes to a device or hub replica (Report 21 §4).
// Each batch and its cursor are written in one transaction: a crash leaves the replica at a batch boundary.
import type { PrismaClient } from "@prisma/client";
import type { Tx } from "@/lib/accounting/posting";
import { Change } from "./server";
import { REPLICATED_TABLES, TABLE_BY_NAME, WireValue, decodeValue } from "./tables";

async function upsert(tx: Tx, table: string, row: Record<string, WireValue>) {
  const t = TABLE_BY_NAME.get(table);
  if (!t) return;
  const cols = Object.keys(row);
  const values = cols.map((c) => decodeValue(row[c]));
  const quoted = cols.map((c) => `"${c}"`).join(", ");
  const marks = cols.map(() => "?").join(", ");
  if (t.appendOnly) {
    // History rows never change once written: insert if missing, otherwise leave untouched
    await tx.$executeRawUnsafe(`INSERT OR IGNORE INTO "${t.name}" (${quoted}) VALUES (${marks})`, ...values);
    return;
  }
  const updates = cols.filter((c) => c !== t.key).map((c) => `"${c}" = excluded."${c}"`).join(", ");
  await tx.$executeRawUnsafe(
    `INSERT INTO "${t.name}" (${quoted}) VALUES (${marks}) ON CONFLICT("${t.key}") DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}`,
    ...values,
  );
}

export async function applyChanges(db: PrismaClient, upstreamId: string, changes: Change[], lastSeq: number) {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("PRAGMA defer_foreign_keys = ON");
    for (const c of changes) {
      const t = TABLE_BY_NAME.get(c.tbl);
      if (!t) continue;
      if (c.op === "D" || !c.row) {
        if (!t.appendOnly) await tx.$executeRawUnsafe(`DELETE FROM "${t.name}" WHERE "${t.key}" = ?`, c.rowId);
      } else {
        await upsert(tx, c.tbl, c.row);
      }
    }
    await tx.syncCursor.upsert({ where: { upstreamId }, create: { upstreamId, lastSeq }, update: { lastSeq } });
  }, { timeout: 120_000 });
}

/**
 * Load a full snapshot and set its cursor. With `prune` (after the upstream was restored from a backup) rows the
 * upstream no longer has are removed, including history rows, so the replica matches the upstream exactly.
 */
export async function applySnapshot(
  db: PrismaClient, upstreamId: string,
  snap: { atSeq: number; tables: { name: string; rows: Record<string, WireValue>[] }[]; epoch?: { id: string } },
  opts: { prune?: boolean } = {},
) {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("PRAGMA defer_foreign_keys = ON");
    // Stale rows go first: a document the upstream re-posted under a new id keeps its entry id and number (D-020)
    if (opts.prune) {
      // History is append-only by trigger (and deleting an entry cascades to its lines): the guards are lifted inside
      // this transaction only and restored before it commits
      const guards = (await tx.$queryRawUnsafe(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (${REPLICATED_TABLES.filter((t) => t.appendOnly).map((t) => `'${t.name}_no_delete'`).join(", ")})`,
      )) as { name: string; sql: string }[];
      for (const g of guards) await tx.$executeRawUnsafe(`DROP TRIGGER "${g.name}"`);
      for (const t of REPLICATED_TABLES) {
        const keep = new Set((snap.tables.find((x) => x.name === t.name)?.rows ?? []).map((r) => String(decodeValue(r[t.key]))));
        const local = (await tx.$queryRawUnsafe(`SELECT "${t.key}" AS k FROM "${t.name}"`)) as { k: unknown }[];
        const gone = local.map((r) => String(r.k)).filter((k) => !keep.has(k));
        for (let i = 0; i < gone.length; i += 400) {
          const part = gone.slice(i, i + 400);
          await tx.$executeRawUnsafe(`DELETE FROM "${t.name}" WHERE "${t.key}" IN (${part.map(() => "?").join(", ")})`, ...part);
        }
      }
      for (const g of guards) await tx.$executeRawUnsafe(g.sql);
    }
    const order = new Map(REPLICATED_TABLES.map((t, i) => [t.name, i]));
    for (const t of [...snap.tables].sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99))) {
      for (const row of t.rows) await upsert(tx, t.name, row);
    }
    const epoch = snap.epoch?.id ?? null;
    await tx.syncCursor.upsert({ where: { upstreamId }, create: { upstreamId, lastSeq: snap.atSeq, epoch }, update: { lastSeq: snap.atSeq, epoch } });
  }, { timeout: 300_000 });
}

export async function cursorOf(db: PrismaClient, upstreamId: string): Promise<number | null> {
  return (await db.syncCursor.findUnique({ where: { upstreamId } }))?.lastSeq ?? null;
}
