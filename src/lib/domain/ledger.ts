// src/lib/domain/ledger.ts - Double-entry posting rules (approved improvement OD-10).
// Party, cash/bank and expense effects reproduce the legacy V_CLedger behaviour (Report 10 TQ-10);
// revenue, inventory, cost-of-goods and rounding accounts are added so every entry balances.
// Journal amounts are posted at paisa precision; exact line values stay on the document lines.
import { Dec, ZERO, add, sub, sum, neg, cmp, isZero, isNegative, roundHalfEven } from "./decimal";
import { documentTotal, TotalRounding, DEFAULT_TOTAL_ROUNDING } from "./rounding";
import type { CostStatus } from "./costing";

export type AccountType = "PARTY" | "CASH_BANK" | "GL";

export interface AccountRef {
  type: AccountType;
  id: string;
}

/** System general-ledger accounts created by the application. */
export const GL = {
  SALES_REVENUE: { type: "GL", id: "SALES_REVENUE" } as AccountRef,
  INVENTORY: { type: "GL", id: "INVENTORY" } as AccountRef,
  COST_OF_GOODS_SOLD: { type: "GL", id: "COST_OF_GOODS_SOLD" } as AccountRef,
  ROUNDING: { type: "GL", id: "ROUNDING_ADJUSTMENT" } as AccountRef,
  OPENING_BALANCE_EQUITY: { type: "GL", id: "OPENING_BALANCE_EQUITY" } as AccountRef,
  SALES_RETURNS: { type: "GL", id: "SALES_RETURNS" } as AccountRef,
  STOCK_GAIN: { type: "GL", id: "STOCK_GAIN" } as AccountRef,
  STOCK_LOSS: { type: "GL", id: "STOCK_LOSS" } as AccountRef,
} as const;

export interface JournalLine {
  account: AccountRef;
  debit: Dec;
  credit: Dec;
  memo?: string;
}

export interface JournalEntry {
  documentType: string;
  lines: JournalLine[];
  /** Lines whose cost could not be established exactly (OD-03): reported, never hidden. */
  costFlags?: { line: number; status: CostStatus }[];
}

const paisa = (a: Dec) => roundHalfEven(a, 2);

function dr(account: AccountRef, amount: Dec, memo?: string): JournalLine {
  return isNegative(amount) ? { account, debit: ZERO, credit: neg(amount), memo } : { account, debit: amount, credit: ZERO, memo };
}

function cr(account: AccountRef, amount: Dec, memo?: string): JournalLine {
  return dr(account, neg(amount), memo);
}

function compact(lines: JournalLine[]): JournalLine[] {
  return lines.filter((l) => !(isZero(l.debit) && isZero(l.credit)));
}

export function totals(entry: JournalEntry): { debit: Dec; credit: Dec } {
  return { debit: sum(entry.lines.map((l) => l.debit)), credit: sum(entry.lines.map((l) => l.credit)) };
}

export function assertBalanced(entry: JournalEntry): JournalEntry {
  const t = totals(entry);
  if (cmp(t.debit, t.credit) !== 0) throw new Error(`Unbalanced ${entry.documentType} entry: Dr ${t.debit} != Cr ${t.credit}`);
  for (const l of entry.lines) {
    if (isNegative(l.debit) || isNegative(l.credit)) throw new Error("Journal amounts cannot be negative");
    if (!isZero(l.debit) && !isZero(l.credit)) throw new Error("A journal line is either a debit or a credit");
  }
  return entry;
}

/** Signed movement of one account in an entry: debit minus credit. */
export function accountMovement(entry: JournalEntry, account: AccountRef): Dec {
  return sum(
    entry.lines
      .filter((l) => l.account.type === account.type && l.account.id === account.id)
      .map((l) => sub(l.debit, l.credit))
  );
}

export interface SoldLine {
  /** Exact line amount (pricing.priceLine). */
  amount: Dec;
  /** Cost of the issued quantity, or null when unavailable (costing.issue). */
  cost: Dec | null;
  costStatus: CostStatus;
}

function costLines(lines: SoldLine[], debitAccount: AccountRef): { lines: JournalLine[]; flags: { line: number; status: CostStatus }[] } {
  const known = lines.filter((l) => l.cost !== null).map((l) => l.cost as Dec);
  const total = paisa(sum(known));
  const flags = lines.map((l, i) => ({ line: i + 1, status: l.costStatus })).filter((f) => f.status !== "ACTUAL");
  return { lines: [dr(debitAccount, total, "Cost of goods"), cr(GL.INVENTORY, total, "Stock out at cost")], flags };
}

/** Credit sale invoice: party Dr printed total; revenue Cr exact (paisa); rounding; cost of goods. */
export function postSaleInvoice(args: {
  party: AccountRef;
  lines: SoldLine[];
  rounding?: TotalRounding;
}): { entry: JournalEntry; total: ReturnType<typeof documentTotal> } {
  const total = documentTotal(args.lines.map((l) => l.amount), args.rounding ?? DEFAULT_TOTAL_ROUNDING.SALE_INVOICE);
  const revenue = paisa(total.exact);
  const cost = costLines(args.lines, GL.COST_OF_GOODS_SOLD);
  const entry: JournalEntry = {
    documentType: "SALE_INVOICE",
    lines: compact([
      dr(args.party, total.total, "Sale invoice"),
      cr(GL.SALES_REVENUE, revenue, "Sales"),
      cr(GL.ROUNDING, sub(total.total, revenue), "Invoice rounding"),
      ...cost.lines,
    ]),
    costFlags: cost.flags,
  };
  return { entry: assertBalanced(entry), total };
}

/**
 * Cash sale (OD-05): genuine sale. Money received goes to the chosen cash/bank account; any unpaid
 * remainder is charged to the named party (legacy charged account #1 "PRINTING PRESS").
 */
export function postCashSale(args: {
  receivedInto: AccountRef;
  amountReceived: Dec;
  party?: AccountRef;
  lines: SoldLine[];
  rounding?: TotalRounding;
}): { entry: JournalEntry; total: ReturnType<typeof documentTotal> } {
  const total = documentTotal(args.lines.map((l) => l.amount), args.rounding ?? DEFAULT_TOTAL_ROUNDING.CASH_SALE);
  if (isNegative(args.amountReceived)) throw new Error("Amount received cannot be negative");
  if (cmp(args.amountReceived, total.total) > 0) throw new Error("Amount received exceeds the cash sale total");
  const remainder = sub(total.total, args.amountReceived);
  if (!isZero(remainder) && !args.party) throw new Error("An unpaid cash sale must name the party that owes the balance");
  const revenue = paisa(total.exact);
  const cost = costLines(args.lines, GL.COST_OF_GOODS_SOLD);
  const entry: JournalEntry = {
    documentType: "CASH_SALE",
    lines: compact([
      dr(args.receivedInto, args.amountReceived, "Cash received"),
      ...(args.party ? [dr(args.party, remainder, "Unpaid balance")] : []),
      cr(GL.SALES_REVENUE, revenue, "Sales"),
      cr(GL.ROUNDING, sub(total.total, revenue), "Invoice rounding"),
      ...cost.lines,
    ]),
    costFlags: cost.flags,
  };
  return { entry: assertBalanced(entry), total };
}

/** Purchase invoice: inventory Dr at line values; party Cr the document total. */
export function postPurchaseInvoice(args: {
  party: AccountRef;
  lineAmounts: Dec[];
  rounding?: TotalRounding;
}): { entry: JournalEntry; total: ReturnType<typeof documentTotal> } {
  const total = documentTotal(args.lineAmounts, args.rounding ?? DEFAULT_TOTAL_ROUNDING.PURCHASE_INVOICE);
  const stockValue = paisa(total.exact);
  const entry: JournalEntry = {
    documentType: "PURCHASE_INVOICE",
    lines: compact([
      dr(GL.INVENTORY, stockValue, "Stock in"),
      dr(GL.ROUNDING, sub(total.total, stockValue), "Invoice rounding"),
      cr(args.party, total.total, "Purchase invoice"),
    ]),
  };
  return { entry: assertBalanced(entry), total };
}

/**
 * Stock issue (OD-05): material leaves stock without revenue. When the cost is known it moves from
 * inventory to the issue account chosen for the reason; zero-value issues post no money at all.
 */
export function postStockIssue(args: { issueAccount: AccountRef; lines: SoldLine[] }): JournalEntry {
  const cost = costLines(args.lines, args.issueAccount);
  return assertBalanced({ documentType: "STOCK_ISSUE", lines: compact(cost.lines), costFlags: cost.flags });
}

/**
 * Explicit "Post as expense" of a recorded charge (freight, loading, bilty, printing; owner rules of
 * 2026-10-22). Recording a charge posts nothing; this entry is built only when the user chooses to
 * recognise it. Paid now: the cash/bank account is credited. Payable: the payee is credited.
 */
export function postChargeExpense(args: { expense: AccountRef; credit: AccountRef; amount: Dec }): JournalEntry {
  const amount = paisa(args.amount);
  if (cmp(amount, ZERO) <= 0) throw new Error("Charge amount must be positive");
  return assertBalanced({
    documentType: "CHARGE_EXPENSE",
    lines: [dr(args.expense, amount, "Charge posted as expense"), cr(args.credit, amount, "Charge posted as expense")],
  });
}

export interface ReturnedLine {
  /** Exact value of the returned quantity at the original price. */
  amount: Dec;
  /** Cost the stock carried when it left (sale return) or arrived (purchase return); null when unknown. */
  cost: Dec | null;
}

/**
 * Sale return (D-08): goods come back at the cost they left with. Revenue is reduced through Sales Returns;
 * the customer is credited, or the refund is paid from cash/bank. Totals round like the sale (OD-01).
 */
export function postSaleReturn(args: { creditTo: AccountRef; lines: ReturnedLine[]; rounding?: TotalRounding }): { entry: JournalEntry; total: ReturnType<typeof documentTotal> } {
  const total = documentTotal(args.lines.map((l) => l.amount), args.rounding ?? DEFAULT_TOTAL_ROUNDING.SALE_INVOICE);
  const value = paisa(total.exact);
  const cost = paisa(sum(args.lines.filter((l) => l.cost !== null).map((l) => l.cost as Dec)));
  const entry: JournalEntry = {
    documentType: "SALE_RETURN",
    lines: compact([
      dr(GL.SALES_RETURNS, value, "Goods returned"),
      dr(GL.ROUNDING, sub(total.total, value), "Return rounding"),
      cr(args.creditTo, total.total, "Sale return"),
      dr(GL.INVENTORY, cost, "Returned stock at original cost"),
      cr(GL.COST_OF_GOODS_SOLD, cost, "Cost of returned goods"),
    ]),
  };
  return { entry: assertBalanced(entry), total };
}

/** Purchase return (D-08): stock leaves at its original purchase value and the supplier is debited. */
export function postPurchaseReturn(args: { party: AccountRef; lineAmounts: Dec[]; rounding?: TotalRounding }): { entry: JournalEntry; total: ReturnType<typeof documentTotal> } {
  const total = documentTotal(args.lineAmounts, args.rounding ?? DEFAULT_TOTAL_ROUNDING.PURCHASE_INVOICE);
  const value = paisa(total.exact);
  const entry: JournalEntry = {
    documentType: "PURCHASE_RETURN",
    lines: compact([
      dr(args.party, total.total, "Purchase return"),
      cr(GL.ROUNDING, sub(total.total, value), "Return rounding"),
      cr(GL.INVENTORY, value, "Stock returned to supplier"),
    ]),
  };
  return { entry: assertBalanced(entry), total };
}

/** Stock count adjustment (D-09): gains are valued at average cost, losses at the cost they leave with. */
export function postStockAdjustment(args: { gain: Dec; loss: Dec }): JournalEntry {
  const gain = paisa(args.gain);
  const loss = paisa(args.loss);
  return assertBalanced({
    documentType: "STOCK_ADJUSTMENT",
    lines: compact([
      dr(GL.INVENTORY, gain, "Count gain"),
      cr(GL.STOCK_GAIN, gain, "Count gain"),
      dr(GL.STOCK_LOSS, loss, "Count shortage"),
      cr(GL.INVENTORY, loss, "Count shortage"),
    ]),
  });
}

/** Receipt from a party into cash/bank (legacy Ccash): party Cr, account Dr. */
export function postReceipt(args: { party: AccountRef; into: AccountRef; amount: Dec }): JournalEntry {
  const amount = paisa(args.amount);
  return assertBalanced({ documentType: "RECEIPT", lines: compact([dr(args.into, amount, "Receipt"), cr(args.party, amount, "Receipt")]) });
}

/** Payment to a party from cash/bank (legacy Vcash): party Dr, account Cr. */
export function postPayment(args: { party: AccountRef; from: AccountRef; amount: Dec }): JournalEntry {
  const amount = paisa(args.amount);
  return assertBalanced({ documentType: "PAYMENT", lines: compact([dr(args.party, amount, "Payment"), cr(args.from, amount, "Payment")]) });
}

/** Voucher between any two accounts (legacy TPV: debit SubCode / credit SubCodeA). */
export function postVoucher(args: { documentType: "PAYMENT_VOUCHER" | "RECEIPT_VOUCHER" | "JOURNAL_VOUCHER"; debit: AccountRef; credit: AccountRef; amount: Dec }): JournalEntry {
  const amount = paisa(args.amount);
  return assertBalanced({ documentType: args.documentType, lines: compact([dr(args.debit, amount), cr(args.credit, amount)]) });
}

/** Opening balance (legacy SubAccount.Dr/Cr) against opening-balance equity. */
export function postOpeningBalance(args: { account: AccountRef; debit: Dec; credit: Dec }): JournalEntry {
  const net = paisa(sub(args.debit, args.credit));
  return assertBalanced({
    documentType: "OPENING_BALANCE",
    lines: compact([dr(args.account, net, "Opening balance"), cr(GL.OPENING_BALANCE_EQUITY, net, "Opening balance")]),
  });
}

/** Transfer between two cash/bank accounts. */
export function postTransfer(args: { from: AccountRef; to: AccountRef; amount: Dec }): JournalEntry {
  const amount = paisa(args.amount);
  if (cmp(amount, ZERO) <= 0) throw new Error("Transfer amount must be positive");
  return assertBalanced({ documentType: "TRANSFER", lines: [dr(args.to, amount, "Transfer in"), cr(args.from, amount, "Transfer out")] });
}

/**
 * Approved improvement OD-09: previous balance, this document and new balance for a party, using the
 * party's signed balance (debit positive = the party owes us).
 */
export function balancePresentation(previousBalance: Dec, entry: JournalEntry, party: AccountRef) {
  const thisDocument = accountMovement(entry, party);
  return { previousBalance, thisDocument, newBalance: add(previousBalance, thisDocument) };
}
