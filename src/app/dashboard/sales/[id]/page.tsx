// src/app/dashboard/sales/[id]/page.tsx - One bill: view, payments, edit, cancel, print, PDF (Report 28).
// Bills made before Sales moved to Books open read-only in their old layout.
import { getAuthUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { loadBill } from "@/lib/sales/bill-view";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { mayEditBill } from "@/lib/sales/books-sales";
import { SaleDetailClient } from "./sale-detail-client";
import BookBillClient from "./book-bill-client";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "sales", "read")) redirect("/dashboard");
  const { id } = await params;

  const bill = await loadBooksBill(prisma, id);
  if (bill) {
    const actor = { id: user.id, role: user.role };
    const editable = bill.doc.status === "POSTED" && can(user.role, "sales", "write") && mayEditBill(actor, bill.doc);
    return (
      <BookBillClient
        bill={JSON.parse(JSON.stringify(bill, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))}
        canEdit={editable}
        canReceive={bill.doc.type === "SALE_INVOICE" && bill.doc.status === "POSTED" && can(user.role, "customerPayments", "write")}
        canCancel={bill.doc.status === "POSTED" && can(user.role, "sales", "delete")}
        printedBy={user.name}
      />
    );
  }

  const older = await loadBill(prisma, id);
  if (!older) notFound();
  return (
    <SaleDetailClient
      sale={JSON.parse(JSON.stringify(older.sale))}
      business={{ name: older.businessName, address: older.businessAddress }}
      words={older.words}
      edits={JSON.parse(JSON.stringify(older.edits))}
      canEdit={false}
      printedBy={user.name}
    />
  );
}
