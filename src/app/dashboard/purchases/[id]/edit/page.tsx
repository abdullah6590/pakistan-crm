// src/app/dashboard/purchases/[id]/edit/page.tsx - Correct a saved purchase bill (Report 30 §6). It becomes a new revision
// with the same number and keeps its payments. Only an administrator or the person who entered the bill may edit it.
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadPurchaseBill } from "@/lib/purchases/queries";
import { mayEditBill } from "@/lib/purchases/books-purchases";
import { PAYMENT_METHOD_ACCOUNTS } from "@/lib/sales/books-sales";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import NewPurchaseClient from "../../new/new-purchase-client";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const bill = await loadPurchaseBill(prisma, id);
  if (!bill) {
    if (await prisma.purchase.findUnique({ where: { id }, select: { id: true } })) redirect(`/dashboard/purchases/${id}`);
    notFound();
  }
  const { doc } = bill;
  if (doc.status !== "POSTED" || !can(user.role, "purchases", "write") || !mayEditBill({ id: user.id, role: user.role }, doc) || !bill.supplier) redirect(`/dashboard/purchases/${id}`);
  const items = await prisma.component.findMany({
    where: { isActive: true }, orderBy: { totalPurchased: "desc" }, take: 15,
    select: { id: true, name: true, sku: true, quantity: true, ...UNIT_FIELDS },
  });
  const toDay = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <NewPurchaseClient
      suppliers={[{ id: bill.supplier.id, name: bill.supplier.name, phone: bill.supplier.phone }]}
      initialItems={JSON.parse(JSON.stringify(items.map(withSaleUnits)))}
      methods={Object.entries(PAYMENT_METHOD_ACCOUNTS).map(([value, m]) => ({ value, label: m.name }))}
      canPay={false}
      editing={JSON.parse(JSON.stringify({
        id: doc.id, docNo: doc.docNo, date: doc.date.toISOString(), supplier: { id: bill.supplier.id, name: bill.supplier.name, phone: bill.supplier.phone },
        vendorBillNo: doc.vendorBillNo, vendorBillDate: toDay(doc.vendorBillDate), dueDate: toDay(doc.dueDate), biltyNo: doc.biltyNo, biltyDate: toDay(doc.biltyDate), notes: doc.remarks,
        lines: doc.lines.filter((l) => l.component).map((l) => ({ quantity: l.quantity, unit: l.unit, loose: l.loose, unitPrice: l.unitPrice ?? "0", item: withSaleUnits(l.component!) })),
      }))}
    />
  );
}
