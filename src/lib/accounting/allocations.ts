// src/lib/accounting/allocations.ts - Payment allocations (Report 28): which receipt paid which invoice or refund.
// Building blocks used by the posting service (cancellation, amendment) and by receivables.ts. An allocation never
// posts anything: the money moves only in the receipt's and the refund's journals. Allocations are never deleted;
// releasing one keeps who released it, when and why.
import type { Prisma, PaymentAllocation } from "@prisma/client";
import { Dec, dec, ZERO, add, cmp, sub, isZero, toPlain } from "@/lib/domain/decimal";

type Tx = Prisma.TransactionClient;

/** Documents that can be paid by allocations: credit sale invoices (cash sales are paid when made). */
export const PAYABLE_TYPES = ["SALE_INVOICE"] as const;
/** Receipts whose money can be allocated: cash and bank receipt vouchers. */
export const RECEIPT_SERIES = ["CRV", "BRV"] as const;
/** Refunds paid back out of a customer's unapplied credit. */
export const REFUND_SERIES = ["CPV", "BPV"] as const;

const ACTIVE = { releasedAt: null } as const;

export function sumAmounts(rows: { amount: string }[]): Dec {
  return rows.reduce((t, r) => add(t, dec(r.amount)), ZERO);
}

/** Money applied to an invoice (or refund) by its active allocations. */
export async function appliedTo(tx: Tx, debitDocId: string): Promise<Dec> {
  return sumAmounts(await tx.paymentAllocation.findMany({ where: { debitDocId, ...ACTIVE }, select: { amount: true } }));
}

/** Money of a receipt already applied to invoices or refunded. */
export async function usedFrom(tx: Tx, creditDocId: string): Promise<Dec> {
  return sumAmounts(await tx.paymentAllocation.findMany({ where: { creditDocId, ...ACTIVE }, select: { amount: true } }));
}

export async function release(tx: Tx, rows: PaymentAllocation[], userId: string, reason: string) {
  const at = new Date();
  for (const a of rows) {
    await tx.paymentAllocation.update({ where: { id: a.id }, data: { releasedAt: at, releasedById: userId, releaseReason: reason } });
  }
}

/** Active allocations on either side of a document. */
export async function activeAllocations(tx: Tx, docId: string) {
  return tx.paymentAllocation.findMany({
    where: { OR: [{ debitDocId: docId }, { creditDocId: docId }], ...ACTIVE },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * A receipt whose credit paid for a refund cannot be cancelled first: the money was handed back, so the refund must
 * be cancelled before the receipt. Returns the refunds that block it (empty when cancelling is fine).
 */
export async function refundsFundedBy(tx: Tx, receiptId: string) {
  const rows = await tx.paymentAllocation.findMany({
    where: { creditDocId: receiptId, source: "REFUND", ...ACTIVE },
    include: { debitDoc: { select: { docNo: true } } },
  });
  return rows.map((r) => r.debitDoc.docNo);
}

/** Cancelling a document releases every allocation on it: an invoice's payments become unapplied credit again. */
export async function releaseForCancelled(tx: Tx, docId: string, userId: string, reason: string) {
  const rows = await activeAllocations(tx, docId);
  await release(tx, rows, userId, `Cancelled: ${reason}`);
  return rows;
}

/**
 * An amended document (new revision) takes over the allocations of the version it replaces, oldest first, up to its
 * new total. Anything above the new total is released and becomes unapplied credit on its receipt, so the screen can
 * ask what to do with it; nothing is decided silently. A different customer on the new revision releases everything.
 */
export async function carryToRevision(
  tx: Tx,
  old: { id: string; partyAccountId: string | null },
  fresh: { id: string; partyAccountId: string | null; total: string; docNo: string },
  userId: string,
) {
  const rows = await activeAllocations(tx, old.id);
  if (rows.length === 0) return { carried: [] as PaymentAllocation[], released: [] as { allocation: PaymentAllocation; amount: Dec }[] };
  const sameParty = old.partyAccountId === fresh.partyAccountId;
  let room = sameParty ? dec(fresh.total) : ZERO;
  const carried: PaymentAllocation[] = [];
  const released: { allocation: PaymentAllocation; amount: Dec }[] = [];
  const at = new Date();
  for (const a of rows) {
    const amount = dec(a.amount);
    const keep = cmp(amount, room) <= 0 ? amount : room;
    const side = a.debitDocId === old.id ? { debitDocId: fresh.id, creditDocId: a.creditDocId } : { debitDocId: a.debitDocId, creditDocId: fresh.id };
    const reason = sameParty ? `Moved to revision ${fresh.docNo}` : `Revision ${fresh.docNo} is for a different customer`;
    await tx.paymentAllocation.update({ where: { id: a.id }, data: { releasedAt: at, releasedById: userId, releaseReason: reason } });
    if (!isZero(keep)) {
      carried.push(await tx.paymentAllocation.create({
        data: { ...side, amount: toPlain(keep), source: "AMENDMENT", movedFromId: a.id, createdById: userId },
      }));
    }
    const excess = sub(amount, keep);
    if (!isZero(excess)) released.push({ allocation: a, amount: excess });
    room = sub(room, keep);
  }
  return { carried, released };
}
