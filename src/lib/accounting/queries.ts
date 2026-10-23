// src/lib/accounting/queries.ts - Ledgers, balances and stock positions computed from posted journals and movements.
import type { PrismaClient } from "@prisma/client";
import { Dec, dec, ZERO, add, sub, mul, div, cmp, isNegative, toPlain, fromPaisa } from "@/lib/domain/decimal";
import { weightPer100Sheets } from "@/lib/domain/pricing";
import { toPacksAndLoose, unitFactor } from "@/lib/domain/units";
import { accountBalance, unitConfigFor } from "./posting";

const s = toPlain;

/** Party/cash/GL statement (F-05, screenshot E01 layout): opening balance, dated rows with item detail, running balance. */
export async function accountStatement(db: PrismaClient, accountId: string, range: { from?: Date; to?: Date } = {}) {
  const account = await db.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account) return null;
  const opening = range.from ? await accountBalance(db, accountId, { before: range.from }) : ZERO;
  const date = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
  const lines = await db.journalLine.findMany({
    where: { accountId, ...(range.from || range.to ? { entry: { date } } : {}) },
    include: { entry: { include: { document: { include: { lines: { orderBy: { lineNo: "asc" } } } } } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
  });
  let balance = opening;
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const rows = lines.map((l) => {
    const debit = fromPaisa(l.debitPaisa);
    const credit = fromPaisa(l.creditPaisa);
    balance = add(balance, sub(debit, credit));
    totalDebit = add(totalDebit, debit);
    totalCredit = add(totalCredit, credit);
    const doc = l.entry.document;
    const showItems = l.entry.kind === "POSTING" && ["SALE_INVOICE", "CASH_SALE", "PURCHASE_INVOICE"].includes(doc.type);
    return {
      date: l.entry.date,
      documentId: doc.id,
      docNo: doc.docNo,
      type: doc.type,
      status: doc.status,
      entryKind: l.entry.kind,
      memo: l.memo,
      remarks: doc.remarks,
      debit: s(debit),
      credit: s(credit),
      balance: s(balance),
      items: showItems
        ? doc.lines.map((x) => ({ description: x.description, quantity: x.quantity, unit: x.unit, loose: x.loose, unitPrice: x.unitPrice, amount: x.amount }))
        : [],
    };
  });
  return { account, opening: s(opening), rows, totalDebit: s(totalDebit), totalCredit: s(totalCredit), closing: s(balance) };
}

/** Balance of every account; debits and credits must be equal (double-entry check). */
export async function trialBalance(db: PrismaClient, upTo?: Date) {
  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: upTo ? { entry: { date: { lte: upTo } } } : undefined,
    _sum: { debitPaisa: true, creditPaisa: true },
  });
  const accounts = await db.ledgerAccount.findMany({ where: { id: { in: sums.map((x) => x.accountId) } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let debitTotal = ZERO;
  let creditTotal = ZERO;
  const rows = sums
    .map((x) => {
      const net = fromPaisa((x._sum.debitPaisa ?? BigInt(0)) - (x._sum.creditPaisa ?? BigInt(0)));
      const a = byId.get(x.accountId)!;
      const debit = isNegative(net) ? ZERO : net;
      const credit = isNegative(net) ? sub(ZERO, net) : ZERO;
      debitTotal = add(debitTotal, debit);
      creditTotal = add(creditTotal, credit);
      return { accountId: a.id, code: a.code, name: a.name, kind: a.kind, subType: a.subType, debit: s(debit), credit: s(credit) };
    })
    .filter((r) => r.debit !== "0" || r.credit !== "0")
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { rows, debitTotal: s(debitTotal), creditTotal: s(creditTotal), balanced: cmp(debitTotal, creditTotal) === 0 };
}

/** Stock position (F-06, screenshot E05): base quantity, packs + loose, weighted-average cost and value. */
export async function stockReport(db: PrismaClient, opts: { locationCode?: string; includeZero?: boolean } = {}) {
  const location = opts.locationCode ? await db.stockLocation.findUnique({ where: { code: opts.locationCode } }) : null;
  const items = await db.component.findMany({
    where: { isActive: true },
    include: { unitProfile: { include: { conversions: true } }, stockBalances: true, costState: true },
    orderBy: { name: "asc" },
  });
  let totalValue = ZERO;
  let uncosted = 0;
  const rows = [];
  for (const c of items) {
    const balances = location ? c.stockBalances.filter((b) => b.locationId === location.id) : c.stockBalances;
    const onHand = balances.reduce((acc, b) => add(acc, dec(b.onHand)), ZERO);
    if (!opts.includeZero && cmp(onHand, ZERO) === 0 && balances.length === 0) continue;
    const { cfg, confirmed } = unitConfigFor(c);
    const avg = c.costState?.averageCost ? dec(c.costState.averageCost) : null;
    const value = avg === null || isNegative(onHand) ? null : mul(onHand, avg);
    if (value !== null) totalValue = add(totalValue, value);
    else if (cmp(onHand, ZERO) > 0) uncosted++;
    const packs = toPacksAndLoose(cfg, onHand, cfg.saleUnit ?? cfg.purchaseUnit);
    rows.push({
      componentId: c.id,
      sku: c.sku,
      name: c.name,
      baseUnit: cfg.baseUnit,
      onHand: s(onHand),
      packs: packs ? { unit: packs.unit, perPack: s(unitFactor(cfg, packs.unit)), packs: s(packs.packs), loose: s(packs.loose) } : null,
      averageCost: avg === null ? null : s(avg),
      value: value === null ? null : s(value),
      unitConfirmed: confirmed,
      negative: isNegative(onHand),
    });
  }
  return { location: location?.code ?? "ALL", rows, totalValue: s(totalValue), uncostedItems: uncosted };
}

/** Press work-in-progress reconciliation (owner decision 2c): what was sent, used, returned, lost and is still held. */
export async function pressReport(db: PrismaClient, pressAccountId: string) {
  const press = await db.ledgerAccount.findUnique({ where: { id: pressAccountId } });
  if (!press) return null;
  const location = await db.stockLocation.findUnique({ where: { code: `PRESS-${press.code}` } });
  if (!location) return { press, rows: [] };
  const movements = await db.stockMovement.findMany({
    where: { locationId: location.id },
    include: { document: { select: { type: true } }, component: { select: { name: true } } },
  });
  const byItem = new Map<string, { name: string; dispatched: Dec; returned: Dec; consumed: Dec; lost: Dec }>();
  for (const m of movements) {
    const row = byItem.get(m.componentId) ?? { name: m.component.name, dispatched: ZERO, returned: ZERO, consumed: ZERO, lost: ZERO };
    const q = dec(m.quantity);
    // Dispatches add to the press; receipts (material used), returns and losses take from it
    if (m.document.type === "PRESS_DISPATCH") row.dispatched = add(row.dispatched, q);
    else if (m.document.type === "PRESS_RETURN") row.returned = sub(row.returned, q);
    else if (m.document.type === "PRESS_RECEIPT") row.consumed = sub(row.consumed, q);
    else if (m.document.type === "PRESS_LOSS") row.lost = sub(row.lost, q);
    byItem.set(m.componentId, row);
  }
  const rows = [...byItem.entries()].map(([componentId, r]) => {
    const held = sub(sub(sub(r.dispatched, r.returned), r.consumed), r.lost);
    return { componentId, name: r.name, dispatched: s(r.dispatched), returned: s(r.returned), consumed: s(r.consumed), lost: s(r.lost), heldAtPress: s(held) };
  });
  return { press, location, rows };
}

export async function pendingApprovals(db: PrismaClient) {
  return db.accountingDocument.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: { lines: { orderBy: { lineNo: "asc" } }, partyAccount: { select: { name: true } } },
    orderBy: { submittedAt: "asc" },
  });
}

/**
 * Decision D-2 (2026-10-22): every approval of a stock issue, press loss or stock count by the person who prepared
 * it (the owner override, with its reason), and every change to who may use the override.
 */
export async function selfApprovalReport(db: PrismaClient, range: { from?: Date; to?: Date } = {}) {
  const when = range.from || range.to ? { createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {};
  const overrides = await db.auditLog.findMany({ where: { action: "APPROVE_SELF_OVERRIDE", ...when }, orderBy: { createdAt: "asc" } });
  const docs = await db.accountingDocument.findMany({
    where: { id: { in: overrides.map((o) => o.entityId) } },
    select: { id: true, docNo: true, type: true, date: true, status: true, createdById: true },
  });
  const changes = await db.auditLog.findMany({ where: { entity: "AccountingSetting", entityId: "SELF_APPROVAL_OVERRIDE_USER", ...when }, orderBy: { createdAt: "asc" } });
  const userIds = [...new Set([...overrides.map((o) => o.userId), ...changes.flatMap((c) => [c.userId, ...[c.before, c.after].map((v) => (v ? String(JSON.parse(v).value ?? "") : ""))])].filter(Boolean))];
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const who = (id: string) => users.get(id) ?? (id ? id : "nobody");
  const value = (v: string | null) => (v ? who(String(JSON.parse(v).value ?? "")) : "nobody");
  return {
    approvals: overrides.map((o) => {
      const d = docs.find((x) => x.id === o.entityId);
      return { at: o.createdAt, documentId: o.entityId, docNo: d?.docNo ?? "?", type: d?.type ?? "?", date: d?.date ?? null, status: d?.status ?? "?", approvedBy: who(o.userId), reason: o.reason ?? "" };
    }),
    settingChanges: changes.map((c) => ({ at: c.createdAt, changedBy: who(c.userId), from: value(c.before), to: value(c.after), reason: c.reason ?? "" })),
  };
}

const SALE_TYPES = ["SALE_INVOICE", "CASH_SALE"];

function dateRange(range: { from?: Date; to?: Date }) {
  return range.from || range.to ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {};
}

/** Daybook (R-04): every journal entry in the period with its document and debit/credit lines. */
export async function daybook(db: PrismaClient, range: { from?: Date; to?: Date } = {}) {
  const entries = await db.journalEntry.findMany({
    where: dateRange(range),
    include: { document: { select: { id: true, docNo: true, type: true, remarks: true } }, lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  let debit = ZERO;
  let credit = ZERO;
  const rows = entries.map((e) => ({
    date: e.date, kind: e.kind, documentId: e.document.id, docNo: e.document.docNo, type: e.document.type, remarks: e.document.remarks,
    lines: e.lines.map((l) => {
      const d = fromPaisa(l.debitPaisa);
      const c = fromPaisa(l.creditPaisa);
      debit = add(debit, d);
      credit = add(credit, c);
      return { code: l.account.code, name: l.account.name, debit: s(d), credit: s(c), memo: l.memo };
    }),
  }));
  return { rows, debitTotal: s(debit), creditTotal: s(credit) };
}

/**
 * Profit (R-07) from sale and cash-sale lines less sale returns, by document or item. Revenue is the exact
 * line value (document rounding is reported separately in the trial balance); cost is split by status so
 * estimated or missing costs are never hidden (OD-03).
 */
export async function profitReport(db: PrismaClient, range: { from?: Date; to?: Date } = {}, groupBy: "document" | "item" = "item") {
  const lines = await db.accountingDocumentLine.findMany({
    where: { document: { type: { in: [...SALE_TYPES, "SALE_RETURN"] }, status: "POSTED", ...dateRange(range) } },
    include: { document: { select: { id: true, docNo: true, type: true, date: true } }, component: { select: { id: true, name: true } } },
  });
  const groups = new Map<string, { key: string; label: string; revenue: Dec; cost: Dec; costedRevenue: Dec; estimated: number; unavailable: number }>();
  let revenue = ZERO, cost = ZERO, uncostedRevenue = ZERO;
  for (const l of lines) {
    const sign = l.document.type === "SALE_RETURN" ? -1 : 1;
    const amount = sign < 0 ? sub(ZERO, dec(l.amount)) : dec(l.amount);
    const lineCost = l.costAmount === null ? null : sign < 0 ? sub(ZERO, dec(l.costAmount)) : dec(l.costAmount);
    const key = groupBy === "document" ? l.document.id : l.componentId ?? "none";
    const label = groupBy === "document" ? l.document.docNo : l.component?.name ?? l.description ?? "-";
    const g = groups.get(key) ?? { key, label, revenue: ZERO, cost: ZERO, costedRevenue: ZERO, estimated: 0, unavailable: 0 };
    g.revenue = add(g.revenue, amount);
    revenue = add(revenue, amount);
    if (lineCost === null) { g.unavailable++; uncostedRevenue = add(uncostedRevenue, amount); }
    else { g.cost = add(g.cost, lineCost); g.costedRevenue = add(g.costedRevenue, amount); cost = add(cost, lineCost); if (l.costStatus === "ESTIMATED") g.estimated++; }
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({
    key: g.key, label: g.label, revenue: s(g.revenue), cost: s(g.cost), profit: s(sub(g.costedRevenue, g.cost)),
    estimatedLines: g.estimated, unavailableLines: g.unavailable,
  })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    rows, revenue: s(revenue), cost: s(cost), profitOnCostedSales: s(sub(sub(revenue, uncostedRevenue), cost)), revenueWithoutCost: s(uncostedRevenue),
  };
}

/** Negative-stock exceptions (R-05, OD-04): every movement that left an item below zero, with its document. */
export async function negativeStockExceptions(db: PrismaClient) {
  const movements = await db.stockMovement.findMany({
    where: { warning: { not: null } },
    include: { document: { select: { id: true, docNo: true, type: true, status: true } }, component: { select: { name: true } }, location: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const current = await db.itemStockBalance.findMany({ include: { component: { select: { name: true } } } });
  return {
    events: movements.map((m) => ({ date: m.date, item: m.component.name, location: m.location.name, quantity: m.quantity, balanceAfter: m.balanceAfter, documentId: m.document.id, docNo: m.document.docNo, status: m.document.status })),
    stillNegative: current.filter((b) => isNegative(dec(b.onHand))).map((b) => ({ item: b.component.name, onHand: b.onHand })),
  };
}

/** Kg bought and sold per paper item and party (R-06); weight from X x Y x GSM / divisor per 100 sheets. */
export async function kgReport(db: PrismaClient, range: { from?: Date; to?: Date } = {}, side: "sale" | "purchase" = "sale") {
  const types = side === "sale" ? SALE_TYPES : ["PURCHASE_INVOICE"];
  const lines = await db.accountingDocumentLine.findMany({
    where: { document: { type: { in: types }, status: "POSTED", ...dateRange(range) }, component: { unitProfile: { kind: "PAPER" } } },
    include: { document: { select: { partyAccount: { select: { name: true } } } }, component: true },
  });
  const groups = new Map<string, { item: string; party: string; sheets: Dec; kg: Dec; amount: Dec }>();
  for (const l of lines) {
    const c = l.component!;
    const per100 = weightPer100Sheets({ x: c.dimensionX ?? 0, y: c.dimensionY ?? 0, gsm: c.gsm ?? 0, divisor: c.divisor ?? undefined });
    const party = l.document.partyAccount?.name ?? "Cash sale";
    const key = `${c.id}|${party}`;
    const g = groups.get(key) ?? { item: c.name, party, sheets: ZERO, kg: ZERO, amount: ZERO };
    g.sheets = add(g.sheets, dec(l.baseQuantity));
    g.kg = add(g.kg, div(mul(dec(l.baseQuantity), per100), dec(100)));
    g.amount = add(g.amount, dec(l.amount));
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ item: g.item, party: g.party, sheets: s(g.sheets), kg: s(g.kg), amount: s(g.amount) }))
    .sort((a, b) => a.item.localeCompare(b.item) || a.party.localeCompare(b.party));
}

/**
 * BR-10 last-price memory: the latest posted purchase and sale price of an item, used to pre-fill the next
 * document. Paper sale rates were typed per invoice in the legacy system, so no sale default is offered for paper.
 */
export async function lastPrices(db: PrismaClient, componentId: string) {
  const find = (types: string[]) => db.accountingDocumentLine.findFirst({
    where: { componentId, document: { type: { in: types }, status: "POSTED" } },
    orderBy: [{ document: { date: "desc" } }, { document: { createdAt: "desc" } }],
    select: { unit: true, unitPrice: true, document: { select: { docNo: true, date: true } } },
  });
  const profile = await db.itemUnitProfile.findUnique({ where: { componentId } });
  const [purchase, sale] = await Promise.all([find(["PURCHASE_INVOICE"]), profile?.kind === "PAPER" ? Promise.resolve(null) : find(SALE_TYPES)]);
  return { purchase, sale };
}
