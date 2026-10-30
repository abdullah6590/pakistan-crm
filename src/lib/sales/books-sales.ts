// src/lib/sales/books-sales.ts - The Sales screens on Books (Report 28 §2). A bill for a registered customer is a
// Books sale invoice against the customer's own account; a walk-in bill is a cash sale. Money received when the bill
// is made is a receipt linked to it. Customers and payment methods are connected to Books accounts automatically.
import type { AccountingDocument, LedgerAccount } from "@prisma/client";
import { Dec, ZERO, add, dec, cmp, isZero, sub, toPlain } from "@/lib/domain/decimal";
import {
  Actor, PostingError, Tx, accountByCode, amendDocument, createCashSale, createSaleInvoice, money, run,
} from "@/lib/accounting/posting";
import { Db } from "@/lib/accounting/setup";
import { receivePayment } from "@/lib/accounting/receivables";

/** Payment methods of the Sales screens and the kind of account their money goes into. */
export const PAYMENT_METHOD_ACCOUNTS: Record<string, { name: string; subType: "CASH" | "BANK" }> = {
  CASH: { name: "Cash in hand", subType: "CASH" },
  BANK_TRANSFER: { name: "Bank account", subType: "BANK" },
  JAZZCASH: { name: "JazzCash", subType: "BANK" },
  EASYPAISA: { name: "EasyPaisa", subType: "BANK" },
  NAYAPAY: { name: "NayaPay", subType: "BANK" },
  SADAPAY: { name: "SadaPay", subType: "BANK" },
  CHEQUE: { name: "Cheques received", subType: "BANK" },
};

async function nextAccountCode(tx: Tx, kind: "PARTY" | "CASH_BANK") {
  const series = await tx.documentSeries.upsert({
    where: { series: `ACCOUNT-${kind}` },
    create: { series: `ACCOUNT-${kind}`, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  return `${kind === "PARTY" ? "P" : "B"}-${String(series.nextNumber - 1).padStart(4, "0")}`;
}

/** The Books account of a customer from the Customers list; created and linked on first use. */
export async function partyForCustomer(tx: Tx, customerId: string, userId: string): Promise<LedgerAccount> {
  const linked = await tx.ledgerAccount.findUnique({ where: { customerId } });
  if (linked) {
    if (!linked.isActive) throw new PostingError(`The account of ${linked.name} is inactive`);
    return linked;
  }
  const c = await tx.customer.findUnique({ where: { id: customerId } });
  if (!c) throw new PostingError("Customer not found", 404);
  if (!c.isActive) throw new PostingError(`${c.name} is an inactive customer`);
  const account = await tx.ledgerAccount.create({
    data: { code: await nextAccountCode(tx, "PARTY"), name: c.name, kind: "PARTY", subType: "CUSTOMER", customerId: c.id, phone: c.phone, address: c.address },
  });
  await tx.auditLog.create({ data: { entity: "LedgerAccount", entityId: account.id, action: "CREATE", userId, reason: "Linked to customer for Sales on Books", after: JSON.stringify({ customerId: c.id, code: account.code }) } });
  return account;
}

/** The cash/bank account for a payment method: an existing one chosen on screen, or the method's default account. */
export async function accountForPayment(tx: Tx, method: string, cashAccountId: string | undefined, userId: string): Promise<LedgerAccount> {
  if (cashAccountId) {
    const a = await tx.ledgerAccount.findUnique({ where: { id: cashAccountId } });
    if (!a || a.kind !== "CASH_BANK") throw new PostingError("Choose a cash or bank account");
    if (!a.isActive) throw new PostingError(`${a.name} is inactive`);
    return a;
  }
  const m = PAYMENT_METHOD_ACCOUNTS[method];
  if (!m) throw new PostingError("Unknown payment method");
  const code = `PM-${method}`;
  const existing = await tx.ledgerAccount.findUnique({ where: { code } });
  if (existing) return existing;
  const account = await tx.ledgerAccount.create({ data: { code, name: m.name, kind: "CASH_BANK", subType: m.subType } });
  await tx.auditLog.create({ data: { entity: "LedgerAccount", entityId: account.id, action: "CREATE", userId, reason: `Default account for payment method ${method}`, after: JSON.stringify({ code }) } });
  return account;
}

export interface SaleLine {
  componentId: string;
  /** Quantity in `unit` (the item's stock unit when left out), plus `loose` stock units with a pack unit. */
  quantity: number | string;
  unit?: string;
  loose?: number | string;
  /** Price of one `unit`. */
  unitPrice: number | string;
}

export interface ScreenSaleInput {
  date?: Date | string;
  /** Registered customer (a sale invoice), or a walk-in name (a cash sale). */
  customerId?: string | null;
  walkInName?: string | null;
  items: SaleLine[];
  notes?: string | null;
  /** Money received now; for a walk-in it defaults to the full total. */
  paidNow?: { amount: number | string; method: string; cashAccountId?: string } | null;
  /** One-time id of the screen action (no duplicate bills on double submit). */
  requestId?: string;
}

function linesFor(items: SaleLine[]) {
  if (!Array.isArray(items) || items.length === 0) throw new PostingError("Add at least one item");
  return items.map((i) => ({ componentId: i.componentId, quantity: i.quantity, unit: i.unit || undefined, loose: i.loose || undefined, unitPrice: i.unitPrice }));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Make a bill from the Sales screen. Returns the posted document and the receipt for money received now, if any. */
export async function createScreenSale(db: Db, actor: Actor, input: ScreenSaleInput) {
  try {
    return await createScreenSaleOnce(db, actor, input);
  } catch (e) {
    // Two identical submits at the same moment: the database's unique command id turned the second away (nothing of it
    // was kept); answer it with the first bill
    const code = (e as { code?: string }).code;
    if (input.requestId && (code === "P2002" || /UNIQUE constraint failed/i.test(String((e as Error).message)))) {
      const first = await db.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (first) return { document: first, receipt: null, repeated: true };
    }
    throw e;
  }
}

function createScreenSaleOnce(db: Db, actor: Actor, input: ScreenSaleInput) {
  return run(db, async (tx) => {
    if (input.requestId) {
      const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (again) return { document: again, receipt: null, repeated: true };
    }
    const date = input.date ?? today();
    const lines = linesFor(input.items);
    const notes = input.notes?.trim() || undefined;
    let document: AccountingDocument;
    let receipt: AccountingDocument | null = null;

    if (input.customerId) {
      const party = await partyForCustomer(tx, input.customerId, actor.id);
      document = (await createSaleInvoice(tx, actor, { date, partyAccountId: party.id, lines, remarks: notes })) as AccountingDocument;
      if (input.requestId) document = await tx.accountingDocument.update({ where: { id: document.id }, data: { commandId: input.requestId } });
      const paid = input.paidNow ? money(input.paidNow.amount, "Amount paid now") : null;
      if (paid && !isZero(paid)) {
        if (cmp(paid, dec(document.total)) > 0) throw new PostingError(`Amount paid now is more than the bill total of ${document.total}; record the extra as an advance from Receive payment`);
        const cash = await accountForPayment(tx, input.paidNow!.method, input.paidNow!.cashAccountId, actor.id);
        const r = await receivePayment(tx, actor, {
          partyAccountId: party.id, cashAccountId: cash.id, date, amount: toPlain(paid),
          allocations: [{ invoiceId: document.id, amount: toPlain(paid) }], remarks: `Paid with ${document.docNo}`,
          requestId: input.requestId ? `${input.requestId}:paid` : undefined,
        });
        receipt = r.receipt;
      }
    } else {
      const name = input.walkInName?.trim();
      if (!name) throw new PostingError("Choose a customer or enter a walk-in name");
      const method = input.paidNow?.method ?? "CASH";
      const cash = await accountForPayment(tx, method, input.paidNow?.cashAccountId, actor.id);
      // A walk-in pays now; any unpaid part is owed by the Counter Sale account (Books rule F-03)
      const counter = await accountByCode(tx, "COUNTER_SALE");
      document = (await createCashSale(tx, actor, {
        date, cashAccountId: cash.id, customerName: name, lines, remarks: notes,
        ...(input.paidNow?.amount !== undefined && input.paidNow?.amount !== "" ? { amountReceived: input.paidNow.amount, partyAccountId: counter.id } : {}),
      })) as AccountingDocument;
      if (input.requestId) document = await tx.accountingDocument.update({ where: { id: document.id }, data: { commandId: input.requestId } });
    }
    return { document, receipt, repeated: false };
  });
}

async function appliedByReceipt(tx: Tx, invoiceId: string) {
  const m = new Map<string, Dec>();
  for (const a of await tx.paymentAllocation.findMany({ where: { debitDocId: invoiceId, releasedAt: null } })) {
    m.set(a.creditDocId, add(m.get(a.creditDocId) ?? ZERO, dec(a.amount)));
  }
  return m;
}

/** Who may change a bill: an administrator, or the person who made it (the rule of the Sales screens). */
export function mayEditBill(actor: Actor, doc: { createdById: string }) {
  return actor.role === "ADMIN" || doc.createdById === actor.id;
}

/**
 * Correct a saved bill. It becomes a new revision with the same number; payments move to it (Report 28 §3). Returns the
 * new revision and any money that no longer fits the bill (now unapplied credit, for the screen to deal with).
 */
export function amendScreenSale(db: Db, actor: Actor, id: string, input: ScreenSaleInput, reason: string) {
  return run(db, async (tx) => {
    const old = await tx.accountingDocument.findUnique({ where: { id } });
    if (!old || !["SALE_INVOICE", "CASH_SALE"].includes(old.type)) throw new PostingError("Bill not found", 404);
    if (!mayEditBill(actor, old)) throw new PostingError("Only an administrator or the person who made this bill can edit it", 403);
    if (!reason?.trim()) throw new PostingError("Give a reason for the change");
    const date = input.date ?? old.date;
    const lines = linesFor(input.items);
    const notes = input.notes?.trim() || undefined;
    let next: unknown;
    if (old.type === "SALE_INVOICE") {
      if (!input.customerId) throw new PostingError("A customer's bill stays a customer's bill; cancel it and make a walk-in bill instead");
      const party = await partyForCustomer(tx, input.customerId, actor.id);
      next = { date, partyAccountId: party.id, lines, remarks: notes };
    } else {
      if (input.customerId) throw new PostingError("A walk-in bill stays a walk-in bill; cancel it and make a customer's bill instead");
      const name = input.walkInName?.trim();
      if (!name) throw new PostingError("Enter the walk-in customer's name");
      const counter = await accountByCode(tx, "COUNTER_SALE");
      const cashAccountId = old.cashAccountId ?? (await accountForPayment(tx, "CASH", undefined, actor.id)).id;
      next = { date, cashAccountId, customerName: name, lines, remarks: notes, ...(input.paidNow?.amount !== undefined ? { amountReceived: input.paidNow.amount, partyAccountId: counter.id } : {}) };
    }
    const before = await appliedByReceipt(tx, id);
    const revised = (await amendDocument(tx, actor, id, next, reason)) as AccountingDocument;
    const after = await appliedByReceipt(tx, revised.id);
    // Money that paid the old version but no longer fits the new one is now the customer's unapplied credit
    const releasedCredit = [...before].map(([receiptId, amount]) => ({ receiptId, amount: sub(amount, after.get(receiptId) ?? ZERO) }))
      .filter((r) => cmp(r.amount, ZERO) > 0)
      .map((r) => ({ receiptId: r.receiptId, amount: toPlain(r.amount) }));
    return { document: revised, releasedCredit };
  });
}
