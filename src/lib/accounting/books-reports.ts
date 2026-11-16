// src/lib/accounting/books-reports.ts - Cash book / bank book (the old program's cash ledger) and party balances (its
// "all balances" list with a minimum-balance filter), from posted journals. Read-only.
import type { Prisma, PrismaClient } from "@prisma/client";
import { Dec, ZERO, add, sub, cmp, isNegative, toPlain, fromPaisa, dec } from "@/lib/domain/decimal";
import { accountBalance } from "./posting";

const s = toPlain;
const abs = (d: Dec) => (isNegative(d) ? sub(ZERO, d) : d);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Day-by-day book of one cash or bank account: opening balance, money in, money out and closing balance for each day
 * with entries, and under each day the documents with the other side of the entry ("Received from TEST Shop").
 */
export async function cashBook(db: PrismaClient, accountId: string, range: { from?: Date; to?: Date } = {}) {
  const account = await db.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account || account.kind !== "CASH_BANK") return null;
  const opening = range.from ? await accountBalance(db, accountId, { before: range.from }) : ZERO;
  const date = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
  const lines = await db.journalLine.findMany({
    where: { accountId, ...(range.from || range.to ? { entry: { date } } : {}) },
    include: { entry: { include: { document: { select: { id: true, docNo: true, type: true, remarks: true } }, lines: { include: { account: { select: { id: true, name: true } } } } } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
  });
  type Day = { date: string; opening: Dec; in: Dec; out: Dec; entries: { documentId: string; docNo: string; type: string; reversal: boolean; particulars: string; remarks: string | null; in: string; out: string }[] };
  const days: Day[] = [];
  let balance = opening;
  let totalIn = ZERO;
  let totalOut = ZERO;
  for (const l of lines) {
    const key = dayOf(l.entry.date);
    let day = days[days.length - 1];
    if (!day || day.date !== key) { day = { date: key, opening: balance, in: ZERO, out: ZERO, entries: [] }; days.push(day); }
    const money = { in: fromPaisa(l.debitPaisa), out: fromPaisa(l.creditPaisa) };
    day.in = add(day.in, money.in);
    day.out = add(day.out, money.out);
    totalIn = add(totalIn, money.in);
    totalOut = add(totalOut, money.out);
    balance = add(balance, sub(money.in, money.out));
    const others = [...new Set(l.entry.lines.filter((x) => x.accountId !== accountId).map((x) => x.account.name))];
    day.entries.push({
      documentId: l.entry.document.id, docNo: l.entry.document.docNo, type: l.entry.document.type, reversal: l.entry.kind === "REVERSAL",
      particulars: others.join(", "), remarks: l.entry.document.remarks, in: s(money.in), out: s(money.out),
    });
  }
  return {
    account: { id: account.id, code: account.code, name: account.name, subType: account.subType },
    opening: s(opening),
    days: days.map((d) => ({ date: d.date, opening: s(d.opening), in: s(d.in), out: s(d.out), closing: s(add(d.opening, sub(d.in, d.out))), entries: d.entries })),
    totalIn: s(totalIn), totalOut: s(totalOut), closing: s(balance),
  };
}

export type PartyType = "CUSTOMER" | "SUPPLIER" | "ALL";

/**
 * Every customer and/or supplier with a balance (debit = they owe you, credit = you owe them), optionally only those
 * whose balance is more than `minimum` either way, as on a date.
 */
export async function partyBalances(db: PrismaClient, opts: { type?: PartyType; minimum?: number; asOf?: Date } = {}) {
  const type = opts.type ?? "ALL";
  const accountWhere: Prisma.LedgerAccountWhereInput = { kind: "PARTY", ...(type === "ALL" ? {} : { subType: type }) };
  const accounts = await db.ledgerAccount.findMany({ where: accountWhere, select: { id: true, code: true, name: true, phone: true, subType: true, isActive: true } });
  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) }, ...(opts.asOf ? { entry: { date: { lte: opts.asOf } } } : {}) },
    _sum: { debitPaisa: true, creditPaisa: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const minimum = Math.max(0, opts.minimum ?? 0);
  let owedToYou = ZERO;
  let youOwe = ZERO;
  const rows = sums
    .map((x) => ({ a: byId.get(x.accountId)!, balance: fromPaisa((x._sum.debitPaisa ?? BigInt(0)) - (x._sum.creditPaisa ?? BigInt(0))) }))
    .filter((r) => cmp(r.balance, ZERO) !== 0 && Number(s(abs(r.balance))) > minimum)
    .sort((x, y) => x.a.name.localeCompare(y.a.name))
    .map((r) => {
      if (isNegative(r.balance)) youOwe = add(youOwe, abs(r.balance)); else owedToYou = add(owedToYou, r.balance);
      return { accountId: r.a.id, code: r.a.code, name: r.a.name, phone: r.a.phone, type: r.a.subType, active: r.a.isActive, balance: s(r.balance) };
    });
  return { rows, owedToYou: s(owedToYou), youOwe: s(youOwe), net: s(sub(owedToYou, youOwe)) };
}

/**
 * Billed, paid and balance of party accounts from Books, for the customer and supplier lists. A customer is billed by
 * debits (bills, opening balance, refunds paid back) and pays by credits (receipts, returns); a supplier the other way
 * round. The balance is positive when the customer owes you, or when you owe the supplier.
 */
export async function partyMoney(db: PrismaClient, accountIds: string[], side: "CUSTOMER" | "SUPPLIER") {
  const out = new Map<string, { billed: string; paid: string; balance: string }>();
  if (!accountIds.length) return out;
  // A cancelled or edited document is undone by a REVERSAL entry with debit and credit swapped. Taken as it is, that
  // would count an undone bill as paid; so reversals are taken off the side they undo (review 2026-11-16).
  const sumsOf = (kind: "POSTING" | "REVERSAL") => db.journalLine.groupBy({
    by: ["accountId"], where: { accountId: { in: accountIds }, entry: { kind } }, _sum: { debitPaisa: true, creditPaisa: true },
  });
  const [posted, reversed] = await Promise.all([sumsOf("POSTING"), sumsOf("REVERSAL")]);
  const undo = new Map(reversed.map((x) => [x.accountId, x._sum]));
  for (const x of posted) {
    const r = undo.get(x.accountId);
    const dr = fromPaisa((x._sum.debitPaisa ?? BigInt(0)) - (r?.creditPaisa ?? BigInt(0)));
    const cr = fromPaisa((x._sum.creditPaisa ?? BigInt(0)) - (r?.debitPaisa ?? BigInt(0)));
    const [billed, paid] = side === "CUSTOMER" ? [dr, cr] : [cr, dr];
    out.set(x.accountId, { billed: s(billed), paid: s(paid), balance: s(sub(billed, paid)) });
  }
  return out;
}

/**
 * Every customer (or supplier) together: what is owed, advances, and how many have a balance. Accounts with no customer
 * or supplier record (the counter-sale account of walk-in cash sales) are not counted as parties; what they are owed is
 * given apart (`otherOwed`).
 */
export async function partyMoneyTotals(db: PrismaClient, side: "CUSTOMER" | "SUPPLIER") {
  const accounts = await db.ledgerAccount.findMany({ where: { kind: "PARTY", subType: side }, select: { id: true, customerId: true, supplierId: true } });
  const linked = new Set(accounts.filter((a) => (side === "CUSTOMER" ? a.customerId : a.supplierId)).map((a) => a.id));
  const money = await partyMoney(db, accounts.map((a) => a.id), side);
  let owed = ZERO, advance = ZERO, otherOwed = ZERO, withBalance = 0;
  for (const [id, m] of money) {
    const b = dec(m.balance);
    if (cmp(b, ZERO) === 0) continue;
    if (!linked.has(id)) { if (!isNegative(b)) otherOwed = add(otherOwed, b); continue; }
    withBalance++;
    if (isNegative(b)) advance = add(advance, abs(b)); else owed = add(owed, b);
  }
  return { owed: s(owed), advance: s(advance), otherOwed: s(otherOwed), withBalance, parties: linked.size };
}

/** The dashboard's money summary: cash in hand, bank, what customers owe you and what you owe suppliers, today. */
export async function moneySummary(db: PrismaClient) {
  const accounts = await db.ledgerAccount.findMany({ where: { kind: { in: ["CASH_BANK", "PARTY"] } }, select: { id: true, kind: true, subType: true } });
  const sums = await db.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: accounts.map((a) => a.id) } }, _sum: { debitPaisa: true, creditPaisa: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let cash = ZERO, bank = ZERO, owedToYou = ZERO, youOwe = ZERO;
  for (const x of sums) {
    const a = byId.get(x.accountId)!;
    const balance = fromPaisa((x._sum.debitPaisa ?? BigInt(0)) - (x._sum.creditPaisa ?? BigInt(0)));
    if (a.kind === "CASH_BANK") { if (a.subType === "BANK") bank = add(bank, balance); else cash = add(cash, balance); }
    else if (isNegative(balance)) youOwe = add(youOwe, abs(balance));
    else owedToYou = add(owedToYou, balance);
  }
  return { cash: s(cash), bank: s(bank), owedToYou: s(owedToYou), youOwe: s(youOwe) };
}
