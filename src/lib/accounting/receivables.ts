// src/lib/accounting/receivables.ts - Customer payments against invoices (Report 28).
// A receipt (CRV/BRV) debits cash/bank and credits the customer; that journal is the only money movement. Its
// allocations say which invoices it paid. Money not allocated stays as the customer's unapplied credit, which can be
// applied to an invoice later or refunded (CPV/BPV). Sales income is posted only by the invoice, never by a receipt.
import type { AccountingDocument, PaymentAllocation, Prisma } from "@prisma/client";
import { Dec, dec, ZERO, add, sub, cmp, isZero, toPlain } from "@/lib/domain/decimal";
import { Actor, PostingError, Tx, audit, createVoucher, getAccount, money, run, toDate } from "./posting";
import { Db } from "./setup";
import { PAYABLE_TYPES, REFUND_SERIES, RECEIPT_SERIES, appliedTo, sumAmounts, usedFrom } from "./allocations";

export interface AllocationInput {
  invoiceId: string;
  amount: number | string;
}

export interface ReceivePaymentInput {
  partyAccountId: string;
  /** Cash or bank account the money went into; it decides the receipt series (CRV cash, BRV bank). */
  cashAccountId: string;
  date: Date | string;
  amount: number | string;
  /** Invoices this money pays; the rest stays as unapplied credit. Never filled in automatically. */
  allocations?: AllocationInput[];
  remarks?: string;
  /** One-time id of the screen action: a repeated submit returns the first result instead of a second receipt. */
  requestId?: string;
}

export interface ApplyCreditInput {
  receiptId: string;
  invoiceId: string;
  amount: number | string;
  requestId?: string;
}

export interface RefundInput {
  partyAccountId: string;
  cashAccountId: string;
  date: Date | string;
  amount: number | string;
  /** Receipts whose unapplied credit is refunded; default: the customer's oldest unapplied receipts first. */
  fromReceipts?: { receiptId: string; amount: number | string }[];
  remarks?: string;
  requestId?: string;
}

const s = toPlain;

function positive(v: number | string, label: string): Dec {
  const d = money(v, label);
  if (isZero(d)) throw new PostingError(`${label} must be more than zero`);
  return d;
}

async function existingFor(tx: Tx, requestId: string | undefined) {
  if (!requestId) return null;
  return tx.accountingDocument.findUnique({ where: { commandId: requestId } });
}

/** An invoice that can be paid: a posted (current) sale invoice of this customer. */
async function payableInvoice(tx: Tx, invoiceId: string, partyAccountId: string): Promise<AccountingDocument> {
  const inv = await tx.accountingDocument.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new PostingError("Invoice not found", 404);
  if (!(PAYABLE_TYPES as readonly string[]).includes(inv.type)) throw new PostingError(`${inv.docNo} is not a sale invoice`);
  if (inv.status !== "POSTED") throw new PostingError(`${inv.docNo} is ${inv.status.toLowerCase()}; payments go to its current version`, 409);
  if (inv.partyAccountId !== partyAccountId) throw new PostingError(`${inv.docNo} belongs to another customer`);
  return inv;
}

async function allocate(tx: Tx, actor: Actor, receipt: AccountingDocument, partyAccountId: string, items: AllocationInput[], source: string, requestId?: string) {
  const seen = new Set<string>();
  const made: PaymentAllocation[] = [];
  let left = sub(dec(receipt.total), await usedFrom(tx, receipt.id));
  for (const [i, it] of items.entries()) {
    if (seen.has(it.invoiceId)) throw new PostingError("The same invoice is listed twice");
    seen.add(it.invoiceId);
    const amount = positive(it.amount, "Amount for an invoice");
    const inv = await payableInvoice(tx, it.invoiceId, partyAccountId);
    const owed = sub(dec(inv.total), await appliedTo(tx, inv.id));
    if (cmp(amount, owed) > 0) throw new PostingError(`${inv.docNo}: only ${s(owed)} is still owed, ${s(amount)} was entered`);
    if (cmp(amount, left) > 0) throw new PostingError(`The amounts for invoices add up to more than the ${s(dec(receipt.total))} received`);
    made.push(await tx.paymentAllocation.create({
      data: { creditDocId: receipt.id, debitDocId: inv.id, amount: s(amount), source, createdById: actor.id, requestId: requestId ? `${requestId}#${i}` : undefined },
    }));
    left = sub(left, amount);
  }
  return made;
}

/**
 * Two identical submits at the same moment: both pass the "already done?" check, and the database's unique command id
 * rejects the second one's transaction (nothing of it is kept). Answer it with the first one's result.
 */
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

function receiptSeries(cash: { subType: string | null }): "CRV" | "BRV" {
  return cash.subType === "BANK" ? "BRV" : "CRV";
}

/** Record money received from a customer and say which invoices it pays. */
export function receivePayment(db: Db, actor: Actor, input: ReceivePaymentInput) {
  return onceOnly(db, input.requestId, () => receivePaymentOnce(db, actor, input), async (receipt) => ({
    receipt, allocations: await db.paymentAllocation.findMany({ where: { creditDocId: receipt.id } }), repeated: true,
  }));
}

function receivePaymentOnce(db: Db, actor: Actor, input: ReceivePaymentInput) {
  return run(db, async (tx) => {
    const again = await existingFor(tx, input.requestId);
    if (again) return { receipt: again, allocations: await tx.paymentAllocation.findMany({ where: { creditDocId: again.id } }), repeated: true };
    const party = await getAccount(tx, input.partyAccountId, ["PARTY"], "Customer account");
    const cash = await getAccount(tx, input.cashAccountId, ["CASH_BANK"], "Cash/bank account");
    const amount = positive(input.amount, "Amount received");
    toDate(input.date);
    const receipt = (await createVoucher(tx, actor, {
      series: receiptSeries(cash), date: input.date, debitAccountId: cash.id, creditAccountId: party.id, amount: s(amount), remarks: input.remarks,
    })) as AccountingDocument;
    const tagged = input.requestId ? await tx.accountingDocument.update({ where: { id: receipt.id }, data: { commandId: input.requestId } }) : receipt;
    const allocations = await allocate(tx, actor, tagged, party.id, input.allocations ?? [], "RECEIPT");
    if (allocations.length) {
      await audit(tx, tagged.id, "ALLOCATE", actor.id, { after: allocations.map((a) => ({ invoiceId: a.debitDocId, amount: a.amount })) });
    }
    return { receipt: tagged, allocations, repeated: false };
  });
}

/** Apply a receipt's unapplied credit to an invoice of the same customer. Moves no money; posts nothing. */
export function applyCredit(db: Db, actor: Actor, input: ApplyCreditInput) {
  return run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.paymentAllocation.findUnique({ where: { requestId: `${input.requestId}#0` } });
      if (again) return { allocation: again, repeated: true };
    }
    const receipt = await tx.accountingDocument.findUnique({ where: { id: input.receiptId } });
    if (!receipt || receipt.type !== "VOUCHER" || !(RECEIPT_SERIES as readonly string[]).includes(receipt.series)) throw new PostingError("Receipt not found", 404);
    if (receipt.status !== "POSTED") throw new PostingError(`${receipt.docNo} is ${receipt.status.toLowerCase()}`, 409);
    if (!receipt.partyAccountId) throw new PostingError(`${receipt.docNo} is not from a customer`);
    const [allocation] = await allocate(tx, actor, receipt, receipt.partyAccountId, [{ invoiceId: input.invoiceId, amount: input.amount }], "APPLY_CREDIT", input.requestId);
    await audit(tx, receipt.id, "APPLY_CREDIT", actor.id, { after: { invoiceId: allocation.debitDocId, amount: allocation.amount } });
    return { allocation, repeated: false };
  });
}

/** Pay unapplied credit back to the customer. The refund voucher is funded by the receipts it draws on. */
export function refundCredit(db: Db, actor: Actor, input: RefundInput) {
  return onceOnly(db, input.requestId, () => refundOnce(db, actor, input), async (refund) => ({ refund, repeated: true }));
}

function refundOnce(db: Db, actor: Actor, input: RefundInput) {
  return run(db, async (tx) => {
    const again = await existingFor(tx, input.requestId);
    if (again) return { refund: again, repeated: true };
    const party = await getAccount(tx, input.partyAccountId, ["PARTY"], "Customer account");
    const cash = await getAccount(tx, input.cashAccountId, ["CASH_BANK"], "Cash/bank account");
    const amount = positive(input.amount, "Refund amount");
    const credit = await unappliedReceipts(tx, party.id);
    const available = credit.reduce((t, r) => add(t, r.unapplied), ZERO);
    if (cmp(amount, available) > 0) throw new PostingError(`Only ${s(available)} of unapplied credit can be refunded`);
    // Which receipts the refund draws on: as chosen, or oldest first
    const plan: { receiptId: string; amount: Dec }[] = [];
    if (input.fromReceipts?.length) {
      for (const f of input.fromReceipts) {
        const r = credit.find((c) => c.receipt.id === f.receiptId);
        const a = positive(f.amount, "Amount from a receipt");
        if (!r) throw new PostingError("That receipt has no unapplied credit for this customer");
        if (cmp(a, r.unapplied) > 0) throw new PostingError(`${r.receipt.docNo} has only ${s(r.unapplied)} unapplied`);
        plan.push({ receiptId: f.receiptId, amount: a });
      }
      const planned = plan.reduce((t, p) => add(t, p.amount), ZERO);
      if (cmp(planned, amount) !== 0) throw new PostingError("The amounts taken from receipts must add up to the refund amount");
    } else {
      let need = amount;
      for (const r of credit) {
        if (isZero(need)) break;
        const take = cmp(r.unapplied, need) <= 0 ? r.unapplied : need;
        plan.push({ receiptId: r.receipt.id, amount: take });
        need = sub(need, take);
      }
    }
    const refund = (await createVoucher(tx, actor, {
      series: cash.subType === "BANK" ? REFUND_SERIES[1] : REFUND_SERIES[0], date: input.date,
      debitAccountId: party.id, creditAccountId: cash.id, amount: s(amount), remarks: input.remarks ?? "Refund of unapplied credit",
    })) as AccountingDocument;
    const tagged = input.requestId ? await tx.accountingDocument.update({ where: { id: refund.id }, data: { commandId: input.requestId } }) : refund;
    for (const p of plan) {
      await tx.paymentAllocation.create({ data: { creditDocId: p.receiptId, debitDocId: tagged.id, amount: s(p.amount), source: "REFUND", createdById: actor.id } });
    }
    await audit(tx, tagged.id, "REFUND", actor.id, { after: plan.map((p) => ({ receiptId: p.receiptId, amount: s(p.amount) })) });
    return { refund: tagged, repeated: false };
  });
}

// ─── Reading ───────────────────────────────────────────────────────

export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export function paymentStatus(total: Dec, paid: Dec): PaymentStatus {
  if (isZero(paid)) return isZero(total) ? "PAID" : "UNPAID";
  return cmp(paid, total) >= 0 ? "PAID" : "PARTIALLY_PAID";
}

/** An invoice's payments (current version), what is still owed, and its status. */
export async function invoicePayments(db: Db | Tx, invoiceId: string) {
  const inv = await db.accountingDocument.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new PostingError("Invoice not found", 404);
  const rows = await db.paymentAllocation.findMany({
    where: { debitDocId: invoiceId, releasedAt: null },
    include: { creditDoc: { select: { id: true, docNo: true, date: true, series: true, cashAccount: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const total = dec(inv.total);
  const paid = sumAmounts(rows);
  const remaining = cmp(paid, total) >= 0 ? ZERO : sub(total, paid);
  return {
    invoice: inv,
    total: s(total),
    paid: s(paid),
    remaining: s(remaining),
    status: inv.status === "POSTED" ? paymentStatus(total, paid) : null,
    payments: rows.map((r) => ({
      allocationId: r.id, receiptId: r.creditDoc.id, receiptNo: r.creditDoc.docNo, date: r.creditDoc.date,
      method: r.creditDoc.cashAccount?.name ?? (r.creditDoc.series === "BRV" ? "Bank" : "Cash"), amount: r.amount, source: r.source,
    })),
  };
}

/** A customer's posted receipts with money not yet applied or refunded, oldest first. */
export async function unappliedReceipts(db: Db | Tx, partyAccountId: string) {
  const receipts = await db.accountingDocument.findMany({
    where: { type: "VOUCHER", series: { in: [...RECEIPT_SERIES] }, status: "POSTED", partyAccountId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const out: { receipt: AccountingDocument; unapplied: Dec }[] = [];
  for (const r of receipts) {
    const unapplied = sub(dec(r.total), await usedFrom(db as Tx, r.id));
    if (cmp(unapplied, ZERO) > 0) out.push({ receipt: r, unapplied });
  }
  return out;
}

/** A customer's posted sale invoices that are not fully paid, oldest first. */
export async function openInvoices(db: Db | Tx, partyAccountId: string) {
  const invoices = await db.accountingDocument.findMany({
    where: { type: { in: [...PAYABLE_TYPES] }, status: "POSTED", partyAccountId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const out: { invoice: AccountingDocument; paid: Dec; remaining: Dec }[] = [];
  for (const inv of invoices) {
    const paid = await appliedTo(db as Tx, inv.id);
    const remaining = sub(dec(inv.total), paid);
    if (cmp(remaining, ZERO) > 0) out.push({ invoice: inv, paid, remaining });
  }
  return out;
}

export type { Prisma };
