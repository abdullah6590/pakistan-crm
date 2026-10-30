// src/lib/accounting/payables.ts - Paying suppliers against purchase bills (Report 30), the mirror of receivables.ts.
// A payment voucher (CPV cash / BPV bank) debits the supplier and credits cash/bank; that journal is the only money
// movement, and the purchase was already posted by its bill, so nothing is expensed twice. Allocations say which bills a
// payment settles. A purchase return also settles its own bill (it lowers what is owed). Money not allocated is the
// supplier's credit (an advance): applied to a later bill or refunded by the supplier (CRV/BRV). Statuses are worked
// out from the bill total and its active allocations, never stored.
import type { AccountingDocument, LedgerAccount, PaymentAllocation } from "@prisma/client";
import { Dec, dec, ZERO, add, sub, cmp, isZero, toPlain } from "@/lib/domain/decimal";
import { Actor, PostingError, PurchaseReturnInput, Tx, audit, createOpeningBalance, createPurchaseReturn, createVoucher, getAccount, money, run, toDate } from "./posting";
import { Db } from "./setup";
import { appliedTo, sumAmounts, usedFrom } from "./allocations";
import { PaymentStatus, paymentStatus } from "./receivables";

/** Supplier payments: cash and bank payment vouchers. */
export const PAYMENT_SERIES = ["CPV", "BPV"] as const;
/** Money a supplier hands back out of their credit: cash and bank receipt vouchers. */
export const SUPPLIER_REFUND_SERIES = ["CRV", "BRV"] as const;

export interface BillAllocationInput {
  billId: string;
  amount: number | string;
}

export interface PaySupplierInput {
  partyAccountId: string;
  /** Cash or bank account the money left from; it decides the voucher series (CPV cash, BPV bank). */
  cashAccountId: string;
  date: Date | string;
  amount: number | string;
  /** Bills this money pays; the rest stays as the supplier's credit (an advance). Never filled in automatically. */
  allocations?: BillAllocationInput[];
  /** Bank transaction, cheque or slip number. */
  reference?: string;
  remarks?: string;
  /** One-time id of the screen action: a repeated submit returns the first result instead of a second payment. */
  requestId?: string;
}

const s = toPlain;

function positive(v: number | string, label: string): Dec {
  const d = money(v, label);
  if (isZero(d)) throw new PostingError(`${label} must be more than zero`);
  return d;
}

/** Two identical submits at the same moment: the unique command id rejects the second; answer with the first. */
async function onceOnly<T>(db: Db, requestId: string | undefined, work: () => Promise<T>, repeat: (doc: AccountingDocument) => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (requestId && (code === "P2002" || /UNIQUE constraint failed/i.test(String((e as Error).message)))) {
      const first = await db.accountingDocument.findUnique({ where: { commandId: requestId } });
      if (first) return repeat(first);
    }
    throw e;
  }
}

async function supplierAccount(tx: Tx, partyAccountId: string): Promise<LedgerAccount> {
  const party = await getAccount(tx, partyAccountId, ["PARTY"], "Supplier account");
  if (party.subType !== "SUPPLIER") throw new PostingError(`${party.name} is not a supplier account`);
  return party;
}

/** Which way a supplier's opening balance went: OWED (the business owed them) or ADVANCE (they held the business's money). */
async function openingSide(tx: Tx, doc: AccountingDocument): Promise<"OWED" | "ADVANCE" | null> {
  if (doc.type !== "OPENING_BALANCE" || !doc.partyAccountId) return null;
  const line = await tx.journalLine.findFirst({ where: { entry: { documentId: doc.id, kind: "POSTING" }, accountId: doc.partyAccountId } });
  if (!line) return null;
  return line.creditPaisa > BigInt(0) ? "OWED" : "ADVANCE";
}
const isOwedOpening = async (tx: Tx, doc: AccountingDocument) => (await openingSide(tx, doc)) === "OWED";

/** A bill that can be paid: a posted (current) purchase bill, or an owed opening balance, of this supplier. */
async function payableBill(tx: Tx, billId: string, partyAccountId: string): Promise<AccountingDocument> {
  const bill = await tx.accountingDocument.findUnique({ where: { id: billId } });
  if (!bill) throw new PostingError("Purchase bill not found", 404);
  if (bill.type !== "PURCHASE_INVOICE" && !(await isOwedOpening(tx, bill))) throw new PostingError(`${bill.docNo} is not a purchase bill`);
  if (bill.status !== "POSTED") throw new PostingError(`${bill.docNo} is ${bill.status.toLowerCase()}; payments go to its current version`, 409);
  if (bill.partyAccountId !== partyAccountId) throw new PostingError(`${bill.docNo} belongs to another supplier`);
  return bill;
}

/** Money a payment or return can still give: its total less what it already settled or funded. */
async function leftOn(tx: Tx, source: AccountingDocument) {
  return sub(dec(source.total), await usedFrom(tx, source.id));
}

async function allocate(tx: Tx, actor: Actor, source: AccountingDocument, partyAccountId: string, items: BillAllocationInput[], kind: string, requestId?: string) {
  const seen = new Set<string>();
  const made: PaymentAllocation[] = [];
  let left = await leftOn(tx, source);
  for (const [i, it] of items.entries()) {
    if (seen.has(it.billId)) throw new PostingError("The same bill is listed twice");
    seen.add(it.billId);
    const amount = positive(it.amount, "Amount for a bill");
    const bill = await payableBill(tx, it.billId, partyAccountId);
    const owed = sub(dec(bill.total), await appliedTo(tx, bill.id));
    if (cmp(amount, owed) > 0) throw new PostingError(`${bill.docNo}: only ${s(owed)} is still payable, ${s(amount)} was entered`);
    if (cmp(amount, left) > 0) throw new PostingError(`The amounts for bills add up to more than the ${s(dec(source.total))} of ${source.docNo}`);
    made.push(await tx.paymentAllocation.create({
      data: { creditDocId: source.id, debitDocId: bill.id, amount: s(amount), source: kind, createdById: actor.id, requestId: requestId ? `${requestId}#${i}` : undefined },
    }));
    left = sub(left, amount);
  }
  return made;
}

// ─── Paying ────────────────────────────────────────────────────────

/** Pay a supplier and say which bills the money settles; the rest is an advance (the supplier's credit). */
export function paySupplier(db: Db, actor: Actor, input: PaySupplierInput) {
  return onceOnly(db, input.requestId, () => paySupplierOnce(db, actor, input), async (payment) => ({
    payment, allocations: await db.paymentAllocation.findMany({ where: { creditDocId: payment.id } }), repeated: true,
  }));
}

function paySupplierOnce(db: Db, actor: Actor, input: PaySupplierInput) {
  return run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (again) return { payment: again, allocations: await tx.paymentAllocation.findMany({ where: { creditDocId: again.id } }), repeated: true };
    }
    const party = await supplierAccount(tx, input.partyAccountId);
    const cash = await getAccount(tx, input.cashAccountId, ["CASH_BANK"], "Cash/bank account");
    const amount = positive(input.amount, "Amount paid");
    toDate(input.date);
    const voucher = (await createVoucher(tx, actor, {
      series: cash.subType === "BANK" ? "BPV" : "CPV", date: input.date, debitAccountId: party.id, creditAccountId: cash.id, amount: s(amount),
      remarks: input.remarks?.trim() || `Payment to ${party.name}`,
    })) as AccountingDocument;
    const payment = await tx.accountingDocument.update({
      where: { id: voucher.id },
      data: { vendorBillNo: input.reference?.trim() || null, ...(input.requestId ? { commandId: input.requestId } : {}) },
    });
    const allocations = await allocate(tx, actor, payment, party.id, input.allocations ?? [], "PAYMENT");
    if (allocations.length) await audit(tx, payment.id, "ALLOCATE", actor.id, { after: allocations.map((a) => ({ billId: a.debitDocId, amount: a.amount })) });
    return { payment, allocations, repeated: false };
  });
}

/** Use a payment's or return's unused money for a bill of the same supplier. Moves no money; posts nothing. */
export function applySupplierCredit(db: Db, actor: Actor, input: { sourceId: string; billId: string; amount: number | string; requestId?: string }) {
  return run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.paymentAllocation.findUnique({ where: { requestId: `${input.requestId}#0` } });
      if (again) return { allocation: again, repeated: true };
    }
    const source = await creditSource(tx, input.sourceId);
    const [allocation] = await allocate(tx, actor, source, source.partyAccountId!, [{ billId: input.billId, amount: input.amount }], "APPLY_CREDIT", input.requestId);
    await audit(tx, source.id, "APPLY_CREDIT", actor.id, { after: { billId: allocation.debitDocId, amount: allocation.amount } });
    return { allocation, repeated: false };
  });
}

async function creditSource(tx: Tx, id: string) {
  const doc = await tx.accountingDocument.findUnique({ where: { id } });
  const ok = doc && ((doc.type === "VOUCHER" && (PAYMENT_SERIES as readonly string[]).includes(doc.series)) || doc.type === "PURCHASE_RETURN" || (await openingSide(tx, doc)) === "ADVANCE");
  if (!doc || !ok) throw new PostingError("Payment or return not found", 404);
  if (doc.status !== "POSTED") throw new PostingError(`${doc.docNo} is ${doc.status.toLowerCase()}`, 409);
  if (!doc.partyAccountId) throw new PostingError(`${doc.docNo} has no supplier`);
  await supplierAccount(tx, doc.partyAccountId);
  return doc;
}

/** Money the supplier pays back out of their credit (overpayment or returned goods): a receipt funded by those sources. */
export function supplierRefund(db: Db, actor: Actor, input: { partyAccountId: string; cashAccountId: string; date: Date | string; amount: number | string; fromSources?: { sourceId: string; amount: number | string }[]; reference?: string; remarks?: string; requestId?: string }) {
  return onceOnly(db, input.requestId, () => run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (again) return { refund: again, repeated: true };
    }
    const party = await supplierAccount(tx, input.partyAccountId);
    const cash = await getAccount(tx, input.cashAccountId, ["CASH_BANK"], "Cash/bank account");
    const amount = positive(input.amount, "Refund amount");
    const credit = await supplierCredit(tx, party.id);
    const available = credit.reduce((t, c) => add(t, c.unapplied), ZERO);
    if (cmp(amount, available) > 0) throw new PostingError(`Only ${s(available)} of the supplier's credit can be refunded`);
    const plan: { sourceId: string; amount: Dec }[] = [];
    if (input.fromSources?.length) {
      for (const f of input.fromSources) {
        const c = credit.find((x) => x.source.id === f.sourceId);
        const a = positive(f.amount, "Amount from a payment or return");
        if (!c) throw new PostingError("That payment or return has no unused credit for this supplier");
        if (cmp(a, c.unapplied) > 0) throw new PostingError(`${c.source.docNo} has only ${s(c.unapplied)} unused`);
        plan.push({ sourceId: f.sourceId, amount: a });
      }
      if (cmp(plan.reduce((t, p) => add(t, p.amount), ZERO), amount) !== 0) throw new PostingError("The amounts taken from payments and returns must add up to the refund amount");
    } else {
      let need = amount;
      for (const c of credit) {
        if (isZero(need)) break;
        const take = cmp(c.unapplied, need) <= 0 ? c.unapplied : need;
        plan.push({ sourceId: c.source.id, amount: take });
        need = sub(need, take);
      }
    }
    const voucher = (await createVoucher(tx, actor, {
      series: cash.subType === "BANK" ? "BRV" : "CRV", date: input.date, debitAccountId: cash.id, creditAccountId: party.id, amount: s(amount),
      remarks: input.remarks?.trim() || `Refund from ${party.name} of their credit`,
    })) as AccountingDocument;
    const refund = await tx.accountingDocument.update({
      where: { id: voucher.id },
      data: { vendorBillNo: input.reference?.trim() || null, ...(input.requestId ? { commandId: input.requestId } : {}) },
    });
    for (const p of plan) {
      await tx.paymentAllocation.create({ data: { creditDocId: p.sourceId, debitDocId: refund.id, amount: s(p.amount), source: "REFUND", createdById: actor.id } });
    }
    await audit(tx, refund.id, "REFUND", actor.id, { after: plan.map((p) => ({ sourceId: p.sourceId, amount: s(p.amount) })) });
    return { refund, repeated: false };
  }), async (refund) => ({ refund, repeated: true }));
}

/**
 * Return goods against a purchase bill. Stock leaves at the value it came in with and the supplier owes the business
 * that much less: the return settles its own bill up to what is still payable; anything more (the bill was already
 * paid) is the supplier's credit, to apply to another bill or to be refunded.
 */
/** How much of a return settled its bill and how much became the supplier's credit. */
async function returnSplit(tx: Tx | Db, purchaseReturn: AccountingDocument) {
  const toBill = await (tx as Tx).paymentAllocation.findFirst({ where: { creditDocId: purchaseReturn.id, source: "RETURN" } });
  const settled = toBill ? dec(toBill.amount) : ZERO;
  return { purchaseReturn, settled: s(settled), credit: s(sub(dec(purchaseReturn.total), settled)) };
}

export function returnToSupplier(db: Db, actor: Actor, input: PurchaseReturnInput & { requestId?: string }) {
  return onceOnly(db, input.requestId, () => run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (again) return { ...(await returnSplit(tx, again)), repeated: true };
    }
    const bill = await tx.accountingDocument.findUnique({ where: { id: input.originalDocumentId } });
    if (!bill || bill.type !== "PURCHASE_INVOICE") throw new PostingError("Purchase bill not found", 404);
    if (bill.status !== "POSTED") throw new PostingError(`${bill.docNo} is ${bill.status.toLowerCase()}; return goods against its current version`, 409);
    const created = (await createPurchaseReturn(tx, actor, input)) as AccountingDocument;
    const purchaseReturn = input.requestId ? await tx.accountingDocument.update({ where: { id: created.id }, data: { commandId: input.requestId } }) : created;
    const owed = sub(dec(bill.total), await appliedTo(tx, bill.id));
    const settle = cmp(dec(purchaseReturn.total), owed) <= 0 ? dec(purchaseReturn.total) : owed;
    if (cmp(settle, ZERO) > 0) {
      await tx.paymentAllocation.create({ data: { creditDocId: purchaseReturn.id, debitDocId: bill.id, amount: s(settle), source: "RETURN", createdById: actor.id } });
    }
    await audit(tx, purchaseReturn.id, "ALLOCATE", actor.id, { after: { billId: bill.id, settled: s(settle), credit: s(sub(dec(purchaseReturn.total), settle)) } });
    return { purchaseReturn, settled: s(settle), credit: s(sub(dec(purchaseReturn.total), settle)), repeated: false };
  }), async (purchaseReturn) => ({ ...(await returnSplit(db, purchaseReturn)), repeated: true }));
}

/**
 * A supplier's opening balance, entered once through a controlled step: an administrator, a written reason, audited.
 * `owed` is what the business owed the supplier when Books started; `advance` is money the supplier held.
 */
export function supplierOpeningBalance(db: Db, actor: Actor, input: { partyAccountId: string; date: Date | string; owed?: number | string; advance?: number | string; reason: string; requestId?: string }) {
  return onceOnly(db, input.requestId, () => run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (again) return { document: again, repeated: true };
    }
    if (actor.role !== "ADMIN") throw new PostingError("Only an administrator can enter an opening balance", 403);
    if (!input.reason || input.reason.trim().length < 10) throw new PostingError("Explain where the opening balance comes from (at least 10 characters)");
    const party = await supplierAccount(tx, input.partyAccountId);
    const existing = await tx.accountingDocument.findFirst({ where: { type: "OPENING_BALANCE", partyAccountId: party.id, status: "POSTED" } });
    if (existing) throw new PostingError(`${party.name} already has an opening balance (${existing.docNo}); cancel it first to enter a different one`, 409);
    const created = (await createOpeningBalance(tx, actor, {
      date: input.date, accountId: party.id, credit: input.owed, debit: input.advance, remarks: `Opening balance: ${input.reason.trim()}`,
    })) as AccountingDocument;
    const document = input.requestId ? await tx.accountingDocument.update({ where: { id: created.id }, data: { commandId: input.requestId } }) : created;
    await audit(tx, document.id, "OPENING_BALANCE", actor.id, { reason: input.reason.trim(), after: { owed: input.owed ?? null, advance: input.advance ?? null } });
    return { document, repeated: false };
  }), async (document) => ({ document, repeated: true }));
}

// ─── Reading ───────────────────────────────────────────────────────

export type BillStatus = PaymentStatus | "CANCELLED" | "REPLACED";

/** A bill's payments and returns (current version), what is still payable, and its status. */
export async function billPayments(db: Db | Tx, billId: string) {
  const bill = await db.accountingDocument.findUnique({ where: { id: billId } });
  if (!bill) throw new PostingError("Purchase bill not found", 404);
  const rows = await db.paymentAllocation.findMany({
    where: { debitDocId: billId, releasedAt: null },
    include: { creditDoc: { select: { id: true, docNo: true, date: true, type: true, series: true, vendorBillNo: true, cashAccount: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const total = dec(bill.total);
  const settled = sumAmounts(rows);
  const returned = sumAmounts(rows.filter((r) => r.creditDoc.type === "PURCHASE_RETURN"));
  const remaining = cmp(settled, total) >= 0 ? ZERO : sub(total, settled);
  const replaced = bill.status === "CANCELLED" && !!(await db.accountingDocument.findUnique({ where: { supersedesId: bill.id }, select: { id: true } }));
  const status: BillStatus = bill.status === "POSTED" ? paymentStatus(total, settled) : replaced ? "REPLACED" : "CANCELLED";
  return {
    bill,
    total: s(total),
    paid: s(sub(settled, returned)),
    returned: s(returned),
    remaining: s(remaining),
    status,
    payments: rows.map((r) => ({
      allocationId: r.id, sourceId: r.creditDoc.id, docNo: r.creditDoc.docNo, date: r.creditDoc.date, kind: r.creditDoc.type === "PURCHASE_RETURN" ? "RETURN" : "PAYMENT",
      method: r.creditDoc.type === "PURCHASE_RETURN" ? "Goods returned" : r.creditDoc.cashAccount?.name ?? (r.creditDoc.series === "BPV" ? "Bank" : "Cash"),
      reference: r.creditDoc.vendorBillNo, amount: r.amount, source: r.source,
    })),
  };
}

/** A supplier's payments and returns with money not yet used for a bill or refunded, oldest first. */
export async function supplierCredit(db: Db | Tx, partyAccountId: string) {
  const sources = await db.accountingDocument.findMany({
    where: { status: "POSTED", partyAccountId, OR: [{ type: "VOUCHER", series: { in: [...PAYMENT_SERIES] } }, { type: "PURCHASE_RETURN" }, { type: "OPENING_BALANCE" }] },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const out: { source: AccountingDocument; unapplied: Dec }[] = [];
  for (const d of sources) {
    if (d.type === "OPENING_BALANCE" && (await openingSide(db as Tx, d)) !== "ADVANCE") continue;
    const unapplied = sub(dec(d.total), await usedFrom(db as Tx, d.id));
    if (cmp(unapplied, ZERO) > 0) out.push({ source: d, unapplied });
  }
  return out;
}

/** A supplier's posted bills (and owed opening balance) that are not fully paid, oldest first. */
export async function openBills(db: Db | Tx, partyAccountId: string) {
  const docs = await db.accountingDocument.findMany({
    where: { status: "POSTED", partyAccountId, type: { in: ["PURCHASE_INVOICE", "OPENING_BALANCE"] } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const out: { bill: AccountingDocument; paid: Dec; remaining: Dec }[] = [];
  for (const d of docs) {
    if (d.type === "OPENING_BALANCE" && !(await isOwedOpening(db as Tx, d))) continue;
    const paid = await appliedTo(db as Tx, d.id);
    const remaining = sub(dec(d.total), paid);
    if (cmp(remaining, ZERO) > 0) out.push({ bill: d, paid, remaining });
  }
  return out;
}

export function billStatus(total: string, settled: string): PaymentStatus {
  return paymentStatus(dec(total), dec(settled));
}
