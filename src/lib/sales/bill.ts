// src/lib/sales/bill.ts - Creating and editing a sale bill (Sales module).
// A bill moves stock, may charge the customer (credit sales) and may record income in Finance. Editing a bill
// first undoes exactly what the bill did, then applies the corrected bill, all in one transaction: stock, the
// customer's balance and Finance always match the bill as it now stands. The invoice number stays the same and
// every edit is kept in the audit log with the bill before and after.
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class SaleError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface SaleLineInput {
  componentId: string;
  quantity: number | string;
  unitPrice: number | string;
}

export interface SaleInput {
  customerId?: string | null;
  walkInName?: string | null;
  paymentMethod?: string;
  paymentStatus?: string;
  discount?: number | string;
  tax?: number | string;
  notes?: string | null;
  items: SaleLineInput[];
}

const owesMoney = (status: string) => status === "PENDING" || status === "PARTIAL";
const receivesMoney = (status: string) => status === "PAID" || status === "PARTIAL";
const chargeNote = (invoiceNumber: string) => `Charge for Sale ${invoiceNumber}`;

function amount(value: number | string | undefined, what: string): number {
  const n = parseFloat(String(value ?? 0)) || 0;
  if (!isFinite(n) || n < 0) throw new SaleError(`Invalid ${what} amount`);
  return n;
}

/** Take the lines off stock and write them to the bill. `costs` keeps the cost already on the bill for items that
 *  were on it before an edit; new items use the item's current cost. */
async function applyLines(tx: Tx, saleId: string, lines: SaleLineInput[], userId: string, reference: string, costs = new Map<string, number>()) {
  if (!Array.isArray(lines) || lines.length === 0) throw new SaleError("Sale must contain at least one item");
  let subtotal = 0;
  let profit = 0;
  for (const line of lines) {
    const qty = parseInt(String(line.quantity), 10);
    if (isNaN(qty) || qty <= 0) throw new SaleError("Item quantity must be a positive integer");
    const unitPrice = parseFloat(String(line.unitPrice));
    if (isNaN(unitPrice) || !isFinite(unitPrice) || unitPrice < 0) throw new SaleError("Invalid unit price");
    const component = await tx.component.findUnique({ where: { id: line.componentId } });
    if (!component) throw new SaleError(`Product ${line.componentId} not found`);
    if (!component.isActive) throw new SaleError(`Product ${component.name} is inactive`);
    if (component.quantity < qty) throw new SaleError(`Insufficient stock for ${component.name}: ${component.quantity} available`);

    const unitCost = costs.get(line.componentId) ?? component.unitCost;
    const lineProfit = (unitPrice - unitCost) * qty;
    await tx.saleItem.create({
      data: { saleId, componentId: line.componentId, quantity: qty, unitCost, unitPrice, totalCost: unitCost * qty, totalPrice: unitPrice * qty, profit: lineProfit },
    });
    // Atomic: stock can never go below zero, even with two sales at once
    const { count } = await tx.component.updateMany({
      where: { id: line.componentId, quantity: { gte: qty } },
      data: { quantity: { decrement: qty }, totalSold: { increment: qty } },
    });
    if (count === 0) throw new SaleError(`Insufficient stock for ${component.name}`);
    const after = await tx.component.findUniqueOrThrow({ where: { id: line.componentId } });
    await tx.inventoryHistory.create({
      data: { componentId: line.componentId, type: "REMOVE", quantity: qty, balanceAfter: after.quantity, reference, performedBy: userId },
    });
    subtotal += unitPrice * qty;
    profit += lineProfit;
  }
  return { subtotal, profit };
}

/** The customer charge and the Finance income a bill creates, as in the original sales flow. */
async function applyMoney(tx: Tx, sale: { id: string; invoiceNumber: string; customerId: string | null; total: number; paymentStatus: string; paymentMethod: string }, userId: string, countVisit: boolean) {
  if (sale.customerId) {
    await tx.customer.update({
      where: { id: sale.customerId },
      data: { ...(owesMoney(sale.paymentStatus) ? { balanceDue: { increment: sale.total } } : {}), ...(countVisit ? { visitCount: { increment: 1 } } : {}) },
    });
    if (owesMoney(sale.paymentStatus)) {
      await tx.customerPayment.create({
        data: { customerId: sale.customerId, amount: sale.total, notes: chargeNote(sale.invoiceNumber), saleId: sale.id, userId },
      });
    }
  }
  if (receivesMoney(sale.paymentStatus)) {
    await tx.finance.create({
      data: {
        transactionRef: `TXN-SALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        type: "INCOME", category: "SALES", amount: sale.total, description: `Sale ${sale.invoiceNumber}`,
        referenceId: sale.id, paymentMethod: sale.paymentMethod, userId,
      },
    });
  }
}

export async function createSale(tx: Tx, userId: string, input: SaleInput, invoiceNumber: string) {
  const sale = await tx.sale.create({
    data: {
      invoiceNumber,
      customerId: input.customerId || null,
      walkInName: input.walkInName || null,
      subtotal: 0, discount: 0, tax: 0, total: 0, profit: 0,
      paymentMethod: input.paymentMethod ?? "CASH",
      paymentStatus: (input.paymentStatus || "PENDING") as never,
      notes: input.notes?.trim() || null,
      userId,
    },
  });
  const { subtotal, profit } = await applyLines(tx, sale.id, input.items, userId, `Sale ${invoiceNumber}`);
  const discount = amount(input.discount, "discount");
  const tax = amount(input.tax, "tax");
  const finalSale = await tx.sale.update({ where: { id: sale.id }, data: { subtotal, discount, tax, total: subtotal - discount + tax, profit } });
  await applyMoney(tx, finalSale, userId, true);
  return finalSale;
}

/** The bill as it is kept in the audit log: enough to see exactly what changed. */
function billSummary(sale: { customerId: string | null; walkInName: string | null; subtotal: number; discount: number; tax: number; total: number; paymentMethod: string; paymentStatus: string; notes: string | null; items: { componentId: string; quantity: number; unitPrice: number }[] }) {
  return {
    customerId: sale.customerId, walkInName: sale.walkInName, paymentMethod: sale.paymentMethod, paymentStatus: sale.paymentStatus,
    subtotal: sale.subtotal, discount: sale.discount, tax: sale.tax, total: sale.total, notes: sale.notes,
    items: sale.items.map((i) => ({ componentId: i.componentId, quantity: i.quantity, unitPrice: i.unitPrice })),
  };
}

/** Correct a saved bill. Only an administrator or the person who made the bill may edit it. */
export async function editSale(db: PrismaClient, user: { id: string; role: string }, saleId: string, input: SaleInput, reason?: string) {
  if (!input.customerId && !input.walkInName?.trim()) throw new SaleError("Choose a customer or enter a walk-in name");
  return db.$transaction(async (tx) => {
    const old = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!old) throw new SaleError("Sale not found", 404);
    if (user.role !== "ADMIN" && old.userId !== user.id) throw new SaleError("Only an administrator or the person who made this bill can edit it", 403);
    const reference = `Sale ${old.invoiceNumber} edited`;

    // 1. Undo the old bill: its lines go back to stock …
    for (const item of old.items) {
      const back = await tx.component.update({ where: { id: item.componentId }, data: { quantity: { increment: item.quantity }, totalSold: { decrement: item.quantity } } });
      await tx.inventoryHistory.create({
        data: { componentId: item.componentId, type: "ADD", quantity: item.quantity, balanceAfter: back.quantity, reference: `${reference} (old lines returned)`, performedBy: user.id },
      });
    }
    await tx.saleItem.deleteMany({ where: { saleId } });
    // … its customer charge is taken back …
    if (old.customerId && owesMoney(old.paymentStatus)) {
      await tx.customer.update({ where: { id: old.customerId }, data: { balanceDue: { decrement: old.total } } });
      const charge = (await tx.customerPayment.findFirst({ where: { customerId: old.customerId, saleId } }))
        ?? (await tx.customerPayment.findFirst({ where: { customerId: old.customerId, notes: chargeNote(old.invoiceNumber) } }));
      if (charge) await tx.customerPayment.delete({ where: { id: charge.id } });
    }
    // … and so is its Finance income
    if (receivesMoney(old.paymentStatus)) {
      await tx.finance.deleteMany({ where: { referenceId: saleId, type: "INCOME", category: "SALES" } });
    }

    // 2. Apply the corrected bill (items already on it keep the cost they were sold at)
    const costs = new Map(old.items.map((i) => [i.componentId, i.unitCost]));
    const { subtotal, profit } = await applyLines(tx, saleId, input.items, user.id, reference, costs);
    const discount = amount(input.discount, "discount");
    const tax = amount(input.tax, "tax");
    const customerId = input.customerId || null;
    const sale = await tx.sale.update({
      where: { id: saleId },
      data: {
        customerId,
        walkInName: customerId ? null : input.walkInName?.trim() || null,
        subtotal, discount, tax, total: subtotal - discount + tax, profit,
        paymentMethod: input.paymentMethod ?? old.paymentMethod,
        paymentStatus: (input.paymentStatus ?? old.paymentStatus) as never,
        notes: input.notes === undefined ? old.notes : input.notes?.trim() || null,
      },
      include: { items: true },
    });
    // A different customer: the visit moves with the bill
    if (old.customerId !== customerId) {
      if (old.customerId) await tx.customer.update({ where: { id: old.customerId }, data: { visitCount: { decrement: 1 } } });
    }
    await applyMoney(tx, sale, user.id, old.customerId !== customerId);

    await tx.auditLog.create({
      data: {
        entity: "Sale", entityId: saleId, action: "AMEND", userId: user.id,
        reason: reason?.trim() || "Bill corrected after it was saved",
        before: JSON.stringify(billSummary(old)), after: JSON.stringify(billSummary(sale)),
      },
    });
    return sale;
  });
}
