// src/lib/purchases/books-purchases.ts - The Purchases screens on Books (Report 30). A purchase bill is a Books purchase
// invoice against the supplier's own account: stock comes in at the bill's prices, the supplier is owed the total
// (paisa kept), and money paid when the bill is entered is a payment voucher linked to it. Freight, loading and bilty
// stay record-only. Suppliers from the Suppliers list get their Books account on first use.
import type { AccountingDocument, LedgerAccount } from "@prisma/client";
import { Dec, ZERO, add, dec, cmp, isZero, sub, toPlain } from "@/lib/domain/decimal";
import { Actor, ChargeInput, ItemLineInput, PostingError, Tx, amendDocument, createPurchaseInvoice, money, run } from "@/lib/accounting/posting";
import { Db } from "@/lib/accounting/setup";
import { paySupplier } from "@/lib/accounting/payables";
import { accountForPayment, mayEditBill } from "@/lib/sales/books-sales";

export { mayEditBill };

async function nextPartyCode(tx: Tx) {
  const series = await tx.documentSeries.upsert({
    where: { series: "ACCOUNT-PARTY" },
    create: { series: "ACCOUNT-PARTY", nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  return `P-${String(series.nextNumber - 1).padStart(4, "0")}`;
}

/** The Books account of a supplier from the Suppliers list (their account reference, e.g. P-0003); made on first use. */
export async function partyForSupplier(tx: Tx, supplierId: string, userId: string, opts: { allowInactive?: boolean } = {}): Promise<LedgerAccount> {
  const linked = await tx.ledgerAccount.findUnique({ where: { supplierId } });
  if (linked) {
    if (!linked.isActive && !opts.allowInactive) throw new PostingError(`The account of ${linked.name} is inactive`);
    return linked;
  }
  const sup = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!sup) throw new PostingError("Supplier not found", 404);
  if (!sup.isActive && !opts.allowInactive) throw new PostingError(`${sup.name} is an archived supplier`);
  const account = await tx.ledgerAccount.create({
    data: { code: await nextPartyCode(tx), name: sup.name, kind: "PARTY", subType: "SUPPLIER", supplierId: sup.id, phone: sup.phone, address: sup.address },
  });
  await tx.auditLog.create({ data: { entity: "LedgerAccount", entityId: account.id, action: "CREATE", userId, reason: "Linked to supplier for Purchases on Books", after: JSON.stringify({ supplierId: sup.id, code: account.code }) } });
  return account;
}

export interface PurchaseLine {
  componentId: string;
  /** Quantity in `unit` (the item's stock unit when left out), plus `loose` stock units with a pack unit. */
  quantity: number | string;
  unit?: string;
  loose?: number | string;
  /** Price of one `unit`; paisa allowed. */
  unitPrice: number | string;
}

export interface ScreenPurchaseInput {
  date?: Date | string;
  supplierId: string;
  /** The supplier's own bill number and date. */
  vendorBillNo?: string | null;
  vendorBillDate?: Date | string | null;
  dueDate?: Date | string | null;
  biltyNo?: string | null;
  biltyDate?: Date | string | null;
  items: PurchaseLine[];
  /** Freight, loading, bilty and similar: recorded only; posting one as an expense is a separate, explicit step. */
  charges?: ChargeInput[];
  notes?: string | null;
  /** Money paid to the supplier with this bill, if any. */
  paidNow?: { amount: number | string; method: string; cashAccountId?: string; reference?: string } | null;
  requestId?: string;
}

function linesFor(items: PurchaseLine[]): ItemLineInput[] {
  if (!Array.isArray(items) || items.length === 0) throw new PostingError("Add at least one item");
  return items.map((i) => ({ componentId: i.componentId, quantity: i.quantity, unit: i.unit || undefined, loose: i.loose || undefined, unitPrice: i.unitPrice }));
}

const today = () => new Date().toISOString().slice(0, 10);

function billInput(input: ScreenPurchaseInput, partyAccountId: string, date: Date | string) {
  return {
    date, partyAccountId, lines: linesFor(input.items),
    vendorBillNo: input.vendorBillNo?.trim() || undefined, vendorBillDate: input.vendorBillDate || null,
    dueDate: input.dueDate || null, biltyNo: input.biltyNo?.trim() || undefined, biltyDate: input.biltyDate || null,
    remarks: input.notes?.trim() || undefined,
  };
}

/** Enter a purchase bill from the Purchases screen, with any money paid now as a linked payment. */
export async function createScreenPurchase(db: Db, actor: Actor, input: ScreenPurchaseInput) {
  try {
    return await createOnce(db, actor, input);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (input.requestId && (code === "P2002" || /UNIQUE constraint failed/i.test(String((e as Error).message)))) {
      const first = await db.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (first) return { document: first, payment: null, repeated: true };
    }
    throw e;
  }
}

function createOnce(db: Db, actor: Actor, input: ScreenPurchaseInput) {
  return run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (again) return { document: again, payment: null, repeated: true };
    }
    const party = await partyForSupplier(tx, input.supplierId, actor.id);
    const date = input.date ?? today();
    if (input.vendorBillNo?.trim()) {
      const dup = await tx.accountingDocument.findFirst({ where: { type: "PURCHASE_INVOICE", status: "POSTED", partyAccountId: party.id, vendorBillNo: input.vendorBillNo.trim() } });
      if (dup) throw new PostingError(`Supplier bill ${input.vendorBillNo.trim()} of ${party.name} is already entered as ${dup.docNo}`, 409);
    }
    let document = (await createPurchaseInvoice(tx, actor, { ...billInput(input, party.id, date), charges: input.charges })) as AccountingDocument;
    if (input.requestId) document = await tx.accountingDocument.update({ where: { id: document.id }, data: { commandId: input.requestId } });
    let payment: AccountingDocument | null = null;
    const paid = input.paidNow ? money(input.paidNow.amount, "Amount paid now") : null;
    if (paid && !isZero(paid)) {
      if (cmp(paid, dec(document.total)) > 0) throw new PostingError(`Amount paid now is more than the bill total of ${document.total}; record the extra as an advance from Pay supplier`);
      const cash = await accountForPayment(tx, input.paidNow!.method, input.paidNow!.cashAccountId, actor.id);
      const r = await paySupplier(tx, actor, {
        partyAccountId: party.id, cashAccountId: cash.id, date, amount: toPlain(paid), reference: input.paidNow!.reference,
        allocations: [{ billId: document.id, amount: toPlain(paid) }], remarks: `Paid with ${document.docNo}`,
        requestId: input.requestId ? `${input.requestId}:paid` : undefined,
      });
      payment = r.payment;
    }
    return { document, payment, repeated: false };
  });
}

async function settledBySource(tx: Tx, billId: string) {
  const m = new Map<string, Dec>();
  for (const a of await tx.paymentAllocation.findMany({ where: { debitDocId: billId, releasedAt: null } })) {
    m.set(a.creditDocId, add(m.get(a.creditDocId) ?? ZERO, dec(a.amount)));
  }
  return m;
}

/**
 * Correct a saved purchase bill. It becomes a new revision with the same number; payments move to it. Money that no
 * longer fits (the bill went down below what was paid) becomes the supplier's credit, returned for the screen to show.
 */
export function amendScreenPurchase(db: Db, actor: Actor, id: string, input: ScreenPurchaseInput, reason: string) {
  return run(db, async (tx) => {
    const old = await tx.accountingDocument.findUnique({ where: { id } });
    if (!old || old.type !== "PURCHASE_INVOICE") throw new PostingError("Purchase bill not found", 404);
    if (!mayEditBill(actor, old)) throw new PostingError("Only an administrator or the person who entered this bill can edit it", 403);
    if (!reason?.trim()) throw new PostingError("Give a reason for the change");
    const party = await partyForSupplier(tx, input.supplierId, actor.id);
    if (party.id !== old.partyAccountId) throw new PostingError("A bill stays with its supplier; cancel it and enter a new bill for the other supplier");
    const before = await settledBySource(tx, id);
    const revised = (await amendDocument(tx, actor, id, billInput(input, party.id, input.date ?? old.date), reason)) as AccountingDocument;
    const after = await settledBySource(tx, revised.id);
    const releasedCredit = [...before].map(([sourceId, amount]) => ({ sourceId, amount: sub(amount, after.get(sourceId) ?? ZERO) }))
      .filter((r) => cmp(r.amount, ZERO) > 0)
      .map((r) => ({ sourceId: r.sourceId, amount: toPlain(r.amount) }));
    return { document: revised, releasedCredit };
  });
}
