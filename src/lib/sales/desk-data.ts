// src/lib/sales/desk-data.ts - A saved sale bill as the sale screen loads it (Edit page and the invoice desk, Report 33):
// its lines in the units they were billed in, with the paper details and remarks they were saved with.
import type { PrismaClient } from "@prisma/client";
import { loadBooksBill } from "./books-queries";
import { withSaleUnits } from "./units";
import { SPEC_FIELDS } from "@/lib/product-spec";
import { UNIT_FIELDS } from "./units";

type Bill = NonNullable<Awaited<ReturnType<typeof loadBooksBill>>>;

export async function screenBill(db: PrismaClient, bill: Bill) {
  const { doc } = bill;
  const customer = doc.partyAccount?.customerId
    ? await db.customer.findUnique({ where: { id: doc.partyAccount.customerId }, select: { id: true, name: true, phone: true, partyNo: true } })
    : null;
  return JSON.parse(JSON.stringify({
    id: doc.id,
    invoiceNumber: doc.docNo,
    type: doc.type,
    date: doc.date.toISOString().slice(0, 10),
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone ?? "", partyNo: customer.partyNo } : null,
    walkInName: doc.type === "CASH_SALE" ? bill.customerName : null,
    walkInPhone: doc.type === "CASH_SALE" ? doc.walkInPhone : null,
    amountReceived: doc.type === "CASH_SALE" ? doc.amountReceived : null,
    notes: bill.notes,
    // Each line comes back in the unit it was billed in (packets, cartons, ...), with its loose stock units
    items: doc.lines.filter((l) => l.component).map((l) => ({
      quantity: Number(l.quantity),
      unit: l.unit,
      loose: Number(l.loose ?? 0),
      baseQuantity: Number(l.baseQuantity),
      unitPrice: Number(l.unitPrice ?? 0),
      component: withSaleUnits(l.component!),
      // The size, gm and rate per kg the line was priced with (as saved, not the item's current values)
      paper: l.paperX && l.paperY && l.paperGsm ? { x: l.paperX, y: l.paperY, gsm: l.paperGsm, divisor: l.paperDivisor, rate: l.ratePerKg } : null,
      remarks: l.remarks,
    })),
  }));
}

/** The starting lists of the sale screen: the most sold items and the most frequent customers. */
export async function startingLists(db: PrismaClient) {
  const [items, customers] = await Promise.all([
    db.component.findMany({
      where: { isActive: true }, orderBy: { totalSold: "desc" }, take: 15,
      select: { id: true, name: true, sku: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true, ...SPEC_FIELDS, ...UNIT_FIELDS },
    }),
    db.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true, partyNo: true }, orderBy: { visitCount: "desc" }, take: 10 }),
  ]);
  return {
    initialItems: JSON.parse(JSON.stringify(items.map(withSaleUnits))),
    initialCustomers: JSON.parse(JSON.stringify(customers.map((c) => ({ ...c, phone: c.phone ?? "" })))),
  };
}
