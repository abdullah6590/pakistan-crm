// src/lib/sync/reconcile.ts - Reconciliation tools (Phase 5, Report 21 §12).
// Central checks run on the ledger authority; local checks run on a device or hub against its own copy and the
// server's totals. Every check reports what it found; none of them changes data.
import type { PrismaClient } from "@prisma/client";
import { dec, ZERO, add, sub, mul, cmp, isZero, toPlain, fromPaisa, Dec } from "@/lib/domain/decimal";

export interface Finding {
  check: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  ref?: string;
}

/** Documents that always move money when posted (zero-amount vouchers and pure stock moves excluded). */
const MONEY_TYPES = ["SALE_INVOICE", "CASH_SALE", "PURCHASE_INVOICE", "SALE_RETURN", "PURCHASE_RETURN", "TRANSFER", "OPENING_BALANCE"];

export async function documentTotals(db: PrismaClient) {
  const docs = await db.accountingDocument.findMany({ where: { status: "POSTED" }, select: { type: true, total: true } });
  const by: Record<string, { count: number; total: string }> = {};
  for (const d of docs) {
    const cur = by[d.type] ?? { count: 0, total: "0" };
    by[d.type] = { count: cur.count + 1, total: toPlain(add(dec(cur.total), dec(d.total))) };
  }
  return by;
}

/** Numbering: every number from 1 to the highest used, with gaps explained where possible. */
export async function numberingReport(db: PrismaClient) {
  const docs = await db.accountingDocument.findMany({ where: { revision: 0 }, select: { series: true, number: true, status: true } });
  const blocks = await db.numberBlock.findMany();
  const series = [...new Set(docs.map((d) => d.series))].sort();
  return series.map((s) => {
    const used = new Map(docs.filter((d) => d.series === s).map((d) => [d.number, d.status]));
    const max = Math.max(0, ...used.keys());
    const gaps: { number: number; reason: string }[] = [];
    for (let n = 1; n <= max; n++) {
      if (used.has(n)) continue;
      const block = blocks.find((b) => b.series === s && n >= b.fromNumber && n <= b.toNumber);
      gaps.push({ number: n, reason: block ? `reserved for office server ${block.deviceId} and not used (block ${block.status.toLowerCase()})` : "unexplained" });
    }
    return { series: s, highest: max, used: used.size, cancelled: [...used.values()].filter((st) => st === "CANCELLED").length, gaps };
  });
}

/** Ledger-authority checks. */
export async function reconcileCentral(db: PrismaClient): Promise<{ findings: Finding[]; totals: Awaited<ReturnType<typeof documentTotals>> }> {
  const f: Finding[] = [];

  // 1. Every journal entry balances
  const entries = await db.journalEntry.findMany({ include: { lines: true, document: { select: { docNo: true } } } });
  for (const e of entries) {
    const dr = e.lines.reduce((a, l) => a + l.debitPaisa, BigInt(0));
    const cr = e.lines.reduce((a, l) => a + l.creditPaisa, BigInt(0));
    if (dr !== cr) f.push({ check: "Unbalanced entry", severity: "ERROR", message: `Debits ${toPlain(fromPaisa(dr))} ≠ credits ${toPlain(fromPaisa(cr))}`, ref: e.document.docNo });
  }

  // 2. Posted documents that should have moved money have a journal
  const posted = await db.accountingDocument.findMany({ where: { status: { in: ["POSTED", "CANCELLED"] }, type: { in: MONEY_TYPES } }, select: { id: true, docNo: true, total: true, _count: { select: { journalEntries: true } } } });
  for (const d of posted) if (!isZero(dec(d.total)) && d._count.journalEntries === 0) f.push({ check: "Incomplete posting", severity: "ERROR", message: "Posted with no journal", ref: d.docNo });

  // 3. Party balance shown on each document = the party's movement in that document's journal
  const withParty = await db.accountingDocument.findMany({
    where: { status: { in: ["POSTED", "CANCELLED"] }, previousBalance: { not: null }, partyAccountId: { not: null } },
    select: { docNo: true, partyAccountId: true, previousBalance: true, newBalance: true, journalEntries: { where: { kind: "POSTING" }, select: { lines: true } } },
  });
  for (const d of withParty) {
    const moved = d.journalEntries.flatMap((e) => e.lines).filter((l) => l.accountId === d.partyAccountId).reduce((a, l) => a + l.debitPaisa - l.creditPaisa, BigInt(0));
    const shown = sub(dec(d.newBalance!), dec(d.previousBalance!));
    if (cmp(shown, fromPaisa(moved)) !== 0) f.push({ check: "Balance on document", severity: "ERROR", message: `Document shows ${toPlain(shown)}, journal moved ${toPlain(fromPaisa(moved))}`, ref: d.docNo });
  }

  // 4. Stock balances equal the movement history, per item and location; cost state equals the sum of locations
  const balances = await db.itemStockBalance.findMany({ include: { component: { select: { name: true } } } });
  const allMoves = await db.stockMovement.findMany({ select: { componentId: true, locationId: true, quantity: true, costAmount: true, kind: true } });
  const sumBy = new Map<string, Dec>();
  for (const m of allMoves) sumBy.set(`${m.componentId}|${m.locationId}`, add(sumBy.get(`${m.componentId}|${m.locationId}`) ?? ZERO, dec(m.quantity)));
  for (const b of balances) {
    const expected = sumBy.get(`${b.componentId}|${b.locationId}`) ?? ZERO;
    if (cmp(expected, dec(b.onHand)) !== 0) f.push({ check: "Stock discrepancy", severity: "ERROR", message: `${b.component.name}: balance ${b.onHand}, movements add up to ${toPlain(expected)}`, ref: b.locationId });
  }
  const costStates = await db.itemCostState.findMany({ include: { component: { select: { name: true } } } });
  for (const c of costStates) {
    const total = balances.filter((b) => b.componentId === c.componentId).reduce((a, b) => add(a, dec(b.onHand)), ZERO);
    if (cmp(total, dec(c.onHand)) !== 0) f.push({ check: "Stock discrepancy", severity: "ERROR", message: `${c.component.name}: cost record holds ${c.onHand}, locations hold ${toPlain(total)}` });
  }

  // 5. Inventory account = value of costed stock movements (reported to the paisa)
  const inv = await db.ledgerAccount.findUnique({ where: { code: "INVENTORY" } });
  if (inv) {
    const agg = await db.journalLine.aggregate({ where: { accountId: inv.id }, _sum: { debitPaisa: true, creditPaisa: true } });
    const gl = fromPaisa((agg._sum.debitPaisa ?? BigInt(0)) - (agg._sum.creditPaisa ?? BigInt(0)));
    const value = allMoves.filter((m) => m.costAmount !== null && !m.kind.startsWith("RELOCATE")).reduce((a, m) => add(a, dec(m.costAmount!)), ZERO);
    const diff = sub(gl, value);
    if (cmp(mul(diff, diff), dec("0.0001")) > 0) {
      f.push({ check: "Inventory value", severity: "WARNING", message: `Inventory account ${toPlain(gl)} vs stock movements ${toPlain(value)} (difference ${toPlain(diff)}; uncosted movements are excluded from both)` });
    }
  }

  // 6. Possible duplicates: same type, party, date and total from different entries
  const docs = await db.accountingDocument.findMany({ where: { status: "POSTED", type: { in: MONEY_TYPES } }, select: { docNo: true, type: true, partyAccountId: true, date: true, total: true, originDeviceId: true } });
  const seen = new Map<string, string>();
  for (const d of docs) {
    const key = `${d.type}|${d.partyAccountId}|${d.date.toISOString().slice(0, 10)}|${d.total}`;
    const prior = seen.get(key);
    if (prior) f.push({ check: "Possible duplicate", severity: "WARNING", message: `Same party, date and total as ${prior}; confirm both are genuine`, ref: d.docNo });
    else seen.set(key, d.docNo);
  }

  // 7. Sync entries that were refused or conflicted (kept for review on the computers)
  const refused = await db.syncInbox.groupBy({ by: ["deviceId", "status"], where: { status: { in: ["REJECTED", "CONFLICT"] } }, _count: true });
  for (const r of refused) f.push({ check: "Unresolved sync entries", severity: "WARNING", message: `${r._count} ${r.status.toLowerCase()} entr${r._count === 1 ? "y" : "ies"} from computer ${r.deviceId}` });

  // 8. Numbering gaps that are not explained by a reserved block
  for (const n of await numberingReport(db)) {
    const unexplained = n.gaps.filter((g) => g.reason === "unexplained");
    if (unexplained.length) f.push({ check: "Numbering gap", severity: "WARNING", message: `${n.series}: ${unexplained.map((g) => g.number).join(", ")} missing` });
  }

  return { findings: f, totals: await documentTotals(db) };
}

/** Device / hub checks: its outbox against its copy, and its copy against the server's totals. */
export async function reconcileLocal(db: PrismaClient, central?: { atSeq: number; totals: Awaited<ReturnType<typeof documentTotals>> }) {
  const f: Finding[] = [];
  const synced = await db.outboxCommand.findMany({ where: { status: "SYNCED", type: "CREATE_DOCUMENT" } });
  for (const s of synced) {
    const doc = await db.accountingDocument.findUnique({ where: { commandId: s.id } });
    const result = s.result ? JSON.parse(s.result) : {};
    if (!doc) {
      f.push({ check: "Missing from local copy", severity: "INFO", message: `${s.provisionalRef} was accepted as ${result.docNo} but is not in this copy yet (next sync)`, ref: s.provisionalRef ?? s.id });
      continue;
    }
    const preview = s.preview ? JSON.parse(s.preview) : null;
    if (preview?.total !== undefined && preview.total !== doc.total) {
      f.push({ check: "Total changed at the server", severity: "WARNING", message: `${s.provisionalRef} showed ${preview.total} here, posted as ${doc.total} (${doc.docNo})`, ref: doc.docNo });
    }
  }
  const review = await db.outboxCommand.count({ where: { status: "NEEDS_REVIEW" } });
  if (review) f.push({ check: "Unresolved sync entries", severity: "WARNING", message: `${review} entr${review === 1 ? "y needs" : "ies need"} review on this computer` });
  const stuck = await db.outboxCommand.count({ where: { status: "FAILED_RETRY", attempts: { gte: 10 } } });
  if (stuck) f.push({ check: "Not reaching the server", severity: "WARNING", message: `${stuck} entr${stuck === 1 ? "y has" : "ies have"} failed 10 or more times` });

  if (central) {
    const cursor = (await db.syncCursor.findFirst({ orderBy: { updatedAt: "desc" } }))?.lastSeq ?? 0;
    if (cursor < central.atSeq) {
      f.push({ check: "Local vs central totals", severity: "INFO", message: `This copy is ${central.atSeq - cursor} change(s) behind the server; compare after the next sync` });
    } else {
      const local = await documentTotals(db);
      for (const type of new Set([...Object.keys(local), ...Object.keys(central.totals)])) {
        const a = local[type] ?? { count: 0, total: "0" };
        const b = central.totals[type] ?? { count: 0, total: "0" };
        if (a.count !== b.count || a.total !== b.total) f.push({ check: "Local vs central totals", severity: "ERROR", message: `${type}: here ${a.count} / ${a.total}, server ${b.count} / ${b.total}` });
      }
    }
  }
  return { findings: f };
}
