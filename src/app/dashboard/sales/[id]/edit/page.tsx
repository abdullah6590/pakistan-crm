// src/app/dashboard/sales/[id]/edit/page.tsx - Correct a saved bill (Report 28 §3). The bill gets a new revision with
// the same number; its payments move with it. Only an administrator or the bill's maker may edit it.
import { catalogReady } from "@/lib/accounting/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { mayEditBill } from "@/lib/sales/books-sales";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import { SPEC_FIELDS } from "@/lib/product-spec";
import PaperSaleClient from "../../new/paper-sale-client";

export const dynamic = "force-dynamic";

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  await catalogReady(); // product and party numbers (Report 32 phase 1)
  if (!user) redirect("/login");
  const { id } = await params;

  const bill = await loadBooksBill(prisma, id);
  if (!bill) {
    // A bill from before Sales moved to Books: read-only
    if (await prisma.sale.findUnique({ where: { id }, select: { id: true } })) redirect(`/dashboard/sales/${id}`);
    notFound();
  }
  const { doc } = bill;
  if (doc.status !== "POSTED" || !can(user.role, "sales", "write") || !mayEditBill({ id: user.id, role: user.role }, doc)) redirect(`/dashboard/sales/${id}`);

  const customer = doc.partyAccount?.customerId
    ? await prisma.customer.findUnique({ where: { id: doc.partyAccount.customerId }, select: { id: true, name: true, phone: true, partyNo: true } })
    : null;
  const [initialComponents, initialCustomers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
      orderBy: { totalSold: "desc" },
      take: 15,
      select: { id: true, name: true, sku: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true, ...SPEC_FIELDS, ...UNIT_FIELDS },
    }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true, partyNo: true }, orderBy: { visitCount: "desc" }, take: 10 }),
  ]);

  return (
    <PaperSaleClient
      initialItems={JSON.parse(JSON.stringify(initialComponents.map(withSaleUnits)))}
      initialCustomers={JSON.parse(JSON.stringify(initialCustomers.map((c) => ({ ...c, phone: c.phone ?? "" }))))}
      editBill={JSON.parse(JSON.stringify({
        id: doc.id,
        invoiceNumber: doc.docNo,
        type: doc.type,
        date: doc.date.toISOString().slice(0, 10),
        customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone ?? "" } : null,
        walkInName: doc.type === "CASH_SALE" ? bill.customerName : null,
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
        })),
      }))}
    />
  );
}
