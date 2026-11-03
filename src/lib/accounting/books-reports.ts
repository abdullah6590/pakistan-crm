// src/lib/accounting/books-reports.ts - Cash book / bank book (the old program's cash ledger) and party balances (its
// "all balances" list with a minimum-balance filter), from posted journals. Read-only.
import type { Prisma, PrismaClient } from "@prisma/client";
import { Dec, ZERO, add, sub, cmp, isNegative, toPlain, fromPaisa } from "@/lib/domain/decimal";
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
