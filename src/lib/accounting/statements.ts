// src/lib/accounting/statements.ts - Profit & Loss for a period and Balance Sheet on a date, worked out from posted
// journals (the same figures as the trial balance, arranged the way an accountant reads them). Read-only.
import type { Prisma, PrismaClient } from "@prisma/client";
import { Dec, ZERO, add, sub, cmp, isNegative, toPlain, fromPaisa } from "@/lib/domain/decimal";

export interface StatementLine { accountId: string; code: string; name: string; amount: string }
export interface StatementGroup { key: string; title: string; lines: StatementLine[]; total: string }

type Account = { id: string; code: string; name: string; kind: string; subType: string | null };

/** Debit minus credit for every account with entries matching `where`; accounts that net to zero are left out. */
async function netByAccount(db: PrismaClient, where: Prisma.JournalLineWhereInput) {
  const sums = await db.journalLine.groupBy({ by: ["accountId"], where, _sum: { debitPaisa: true, creditPaisa: true } });
  const accounts = await db.ledgerAccount.findMany({
    where: { id: { in: sums.map((x) => x.accountId) } },
    select: { id: true, code: true, name: true, kind: true, subType: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return sums
    .map((x) => ({ account: byId.get(x.accountId)!, net: fromPaisa((x._sum.debitPaisa ?? BigInt(0)) - (x._sum.creditPaisa ?? BigInt(0))) }))
    .filter((x) => x.account && cmp(x.net, ZERO) !== 0);
}

function group(key: string, title: string, items: { account: Account; amount: Dec }[]): StatementGroup & { sum: Dec } {
  const lines = items
    .sort((a, b) => a.account.name.localeCompare(b.account.name))
    .map((i) => ({ accountId: i.account.id, code: i.account.code, name: i.account.name, amount: toPlain(i.amount) }));
  const sum = items.reduce((t, i) => add(t, i.amount), ZERO);
  return { key, title, lines, total: toPlain(sum), sum };
}
const plain = (g: StatementGroup & { sum: Dec }): StatementGroup => ({ key: g.key, title: g.title, lines: g.lines, total: g.total });
const neg = (d: Dec) => sub(ZERO, d);

const SALES = new Set(["SALES_REVENUE", "SALES_RETURNS"]);
const COGS = "COST_OF_GOODS_SOLD";
const isIncome = (a: Account) => a.kind === "GL" && a.subType === "INCOME";
const isExpense = (a: Account) => a.kind === "GL" && a.subType === "EXPENSE";

function dateWhere(range: { from?: Date; to?: Date }): Prisma.JournalLineWhereInput {
  if (!range.from && !range.to) return {};
  return { entry: { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } };
}

/**
 * Profit & Loss: sales (less returns), cost of goods sold, gross profit, other income, expenses, net profit.
 * Income is shown as credit minus debit, costs as debit minus credit, so every figure reads as a positive amount.
 */
export async function profitAndLoss(db: PrismaClient, range: { from?: Date; to?: Date } = {}) {
  const rows = (await netByAccount(db, dateWhere(range))).filter((r) => isIncome(r.account) || isExpense(r.account));
  const sales = group("sales", "Sales", rows.filter((r) => SALES.has(r.account.code)).map((r) => ({ account: r.account, amount: neg(r.net) })));
  const cogs = group("cogs", "Cost of goods sold", rows.filter((r) => r.account.code === COGS).map((r) => ({ account: r.account, amount: r.net })));
  const otherIncome = group("other-income", "Other income", rows.filter((r) => isIncome(r.account) && !SALES.has(r.account.code)).map((r) => ({ account: r.account, amount: neg(r.net) })));
  const expenses = group("expenses", "Expenses", rows.filter((r) => isExpense(r.account) && r.account.code !== COGS).map((r) => ({ account: r.account, amount: r.net })));
  const grossProfit = sub(sales.sum, cogs.sum);
  const netProfit = sub(add(grossProfit, otherIncome.sum), expenses.sum);
  return {
    sales: plain(sales), cogs: plain(cogs), grossProfit: toPlain(grossProfit),
    otherIncome: plain(otherIncome), expenses: plain(expenses), netProfit: toPlain(netProfit),
  };
}

/**
 * Balance Sheet on a date: what the business has (assets), what it owes (liabilities) and the owner's share (equity,
 * including profit to date that has not been closed into equity). Party accounts go to whichever side their balance
 * is on: a customer who owes money is an asset, a customer who paid in advance is a liability; suppliers the reverse.
 */
export async function balanceSheet(db: PrismaClient, asOf?: Date) {
  const rows = await netByAccount(db, asOf ? { entry: { date: { lte: asOf } } } : {});
  const debit = (r: { net: Dec }) => !isNegative(r.net);
  const pick = (test: (a: Account, r: { net: Dec }) => boolean, sign: "asset" | "claim") =>
    rows.filter((r) => test(r.account, r)).map((r) => ({ account: r.account, amount: sign === "asset" ? r.net : neg(r.net) }));
  const party = (a: Account, sub?: string) => a.kind === "PARTY" && (sub ? a.subType === sub : !["CUSTOMER", "SUPPLIER"].includes(a.subType ?? ""));

  const assets = [
    group("cash-bank", "Cash and bank", pick((a) => a.kind === "CASH_BANK", "asset")),
    group("stock", "Stock and other assets", pick((a) => a.kind === "GL" && a.subType === "ASSET", "asset")),
    group("receivables", "Customers who owe you", pick((a, r) => party(a, "CUSTOMER") && debit(r), "asset")),
    group("supplier-advances", "Advances paid to suppliers", pick((a, r) => party(a, "SUPPLIER") && debit(r), "asset")),
    group("other-receivables", "Other parties who owe you", pick((a, r) => party(a) && debit(r), "asset")),
    group("other-assets", "Other debit balances", pick((a, r) => a.kind === "GL" && !a.subType && debit(r), "asset")),
  ];
  const liabilities = [
    group("payables", "Suppliers you owe", pick((a, r) => party(a, "SUPPLIER") && !debit(r), "claim")),
    group("customer-advances", "Advances received from customers", pick((a, r) => party(a, "CUSTOMER") && !debit(r), "claim")),
    group("other-payables", "Other parties you owe", pick((a, r) => party(a) && !debit(r), "claim")),
    group("liabilities", "Other liabilities", pick((a) => a.kind === "GL" && a.subType === "LIABILITY", "claim")),
    group("other-credits", "Other credit balances", pick((a, r) => a.kind === "GL" && !a.subType && !debit(r), "claim")),
  ];
  const equityGroup = group("equity", "Owner's equity", pick((a) => a.kind === "GL" && a.subType === "EQUITY", "claim"));
  const profitToDate = rows.filter((r) => isIncome(r.account) || isExpense(r.account)).reduce((t, r) => sub(t, r.net), ZERO);

  const total = (gs: { sum: Dec }[]) => gs.reduce((t, g) => add(t, g.sum), ZERO);
  const assetsTotal = total(assets);
  const liabilitiesTotal = total(liabilities);
  const equityTotal = add(equityGroup.sum, profitToDate);
  return {
    assets: assets.filter((g) => g.lines.length).map(plain),
    assetsTotal: toPlain(assetsTotal),
    liabilities: liabilities.filter((g) => g.lines.length).map(plain),
    liabilitiesTotal: toPlain(liabilitiesTotal),
    equity: plain(equityGroup),
    profitToDate: toPlain(profitToDate),
    equityTotal: toPlain(equityTotal),
    liabilitiesAndEquityTotal: toPlain(add(liabilitiesTotal, equityTotal)),
    balanced: cmp(assetsTotal, add(liabilitiesTotal, equityTotal)) === 0,
  };
}
