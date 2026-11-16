// src/app/dashboard/purchases/desk/page.tsx - The Supplier Invoice desk (old "Stock invoice", Report 33): the same grid
// and keys as the Customer Invoice, with Sup-Id, S-Inv #, Inv Date, BL # and BL Date. It opens on the last bill, locked;
// << < > >> and Find show other bills in the same window; New; Edit with a reason; Print. Administrators and
// accountants only (P-3).
import { redirect } from "next/navigation";
import { catalogReady } from "@/lib/accounting/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadPurchaseBill } from "@/lib/purchases/queries";
import { stepBill } from "@/lib/sales/step";
import { startingLists } from "@/lib/sales/desk-data";
import { withSaleUnits } from "@/lib/sales/units";
import PaperSaleClient from "../../sales/new/paper-sale-client";

export const dynamic = "force-dynamic";
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export default async function SupplierDeskPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "purchases", "read")) redirect("/dashboard");
  await catalogReady();
  const sp = await searchParams;
  const { initialItems } = await startingLists(prisma);
  const suppliers = await prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true, partyNo: true }, orderBy: { updatedAt: "desc" }, take: 10 });
  const initialCustomers = JSON.parse(JSON.stringify(suppliers.map((s) => ({ ...s, phone: s.phone ?? "" }))));
  const canWrite = can(user.role, "purchases", "write");

  const id = sp.new === "1" ? null : sp.id ?? (await stepBill(prisma, "PURCHASE_INVOICE", "last"))?.id ?? null;
  const bill = id ? await loadPurchaseBill(prisma, id) : null;
  if (!bill) {
    if (!canWrite) redirect("/dashboard/purchases");
    return <PaperSaleClient key="new-purchase" side="purchase" initialItems={initialItems} initialCustomers={initialCustomers} desk={{ kind: "PURCHASE_INVOICE" }} />;
  }
  const { doc } = bill;
  const supplier = doc.partyAccount?.supplierId
    ? await prisma.supplier.findUnique({ where: { id: doc.partyAccount.supplierId }, select: { id: true, name: true, phone: true, partyNo: true } })
    : null;
  const editBill = JSON.parse(JSON.stringify({
    id: doc.id, invoiceNumber: doc.docNo, type: doc.type, date: day(doc.date),
    customer: supplier ? { id: supplier.id, name: supplier.name, phone: supplier.phone ?? "", partyNo: supplier.partyNo } : null,
    walkInName: null, amountReceived: null, notes: doc.remarks,
    vendorBillNo: doc.vendorBillNo, vendorBillDate: day(doc.vendorBillDate), biltyNo: doc.biltyNo, biltyDate: day(doc.biltyDate),
    items: doc.lines.filter((l) => l.component).map((l) => ({
      quantity: Number(l.quantity), unit: l.unit, loose: Number(l.loose ?? 0), baseQuantity: Number(l.baseQuantity), unitPrice: Number(l.unitPrice ?? 0),
      component: withSaleUnits(l.component!),
      paper: l.paperX && l.paperY && l.paperGsm ? { x: l.paperX, y: l.paperY, gsm: l.paperGsm, divisor: l.paperDivisor, rate: l.ratePerKg } : null,
      remarks: l.remarks,
    })),
  }));
  const current = doc.status === "POSTED";
  return (
    <PaperSaleClient
      key={doc.id}
      side="purchase"
      initialItems={initialItems}
      initialCustomers={initialCustomers}
      editBill={editBill}
      desk={{
        kind: "PURCHASE_INVOICE", locked: true, status: doc.status, printCount: doc.printCount,
        lastPrintedAt: doc.lastPrintedAt ? doc.lastPrintedAt.toISOString() : null,
        total: bill.total, paid: bill.paid, remaining: bill.remaining,
        previousBalance: doc.previousBalance, newBalance: doc.newBalance,
        // A bill with an active return cannot be edited (Report 30); the API refuses it too
        canEdit: current && canWrite && !doc.returns.some((r) => r.status === "POSTED"),
        canCashUpdate: false, canNew: canWrite,
      }}
    />
  );
}
