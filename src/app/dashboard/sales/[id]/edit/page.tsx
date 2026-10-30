// src/app/dashboard/sales/[id]/edit/page.tsx - Correct a saved bill (Report 28 §3). The bill gets a new revision with
// the same number; its payments move with it. Only an administrator or the bill's maker may edit it.
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { mayEditBill } from "@/lib/sales/books-sales";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import NewSaleClient from "../../new/new-sale-client";

export const dynamic = "force-dynamic";

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
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
    ? await prisma.customer.findUnique({ where: { id: doc.partyAccount.customerId }, select: { id: true, name: true, phone: true } })
    : null;
  const [initialComponents, initialCustomers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
      orderBy: { totalSold: "desc" },
      take: 15,
      select: { id: true, name: true, sku: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true, ...UNIT_FIELDS },
    }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true }, orderBy: { visitCount: "desc" }, take: 10 }),
  ]);

  return (
    <NewSaleClient
      initialComponents={JSON.parse(JSON.stringify(initialComponents.map(withSaleUnits)))}
      initialCustomers={JSON.parse(JSON.stringify(initialCustomers))}
      editSale={JSON.parse(JSON.stringify({
        id: doc.id,
        invoiceNumber: doc.docNo,
        type: doc.type,
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
          unitCost: l.component!.unitCost,
          component: withSaleUnits(l.component!),
        })),
      }))}
    />
  );
}
