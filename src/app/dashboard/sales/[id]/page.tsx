// src/app/dashboard/sales/[id]/page.tsx - One sale bill: view, edit, print, PDF
import { getAuthUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { loadBill } from "@/lib/sales/bill-view";
import { SaleDetailClient } from "./sale-detail-client";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const bill = await loadBill(prisma, id);
  if (!bill) notFound();

  // Same rule as the API: an administrator, or the person who made the bill
  const canEdit = can(user.role, "sales", "write") && (user.role === "ADMIN" || bill.sale.userId === user.id);

  return (
    <SaleDetailClient
      sale={JSON.parse(JSON.stringify(bill.sale))}
      business={{ name: bill.businessName, address: bill.businessAddress }}
      words={bill.words}
      edits={JSON.parse(JSON.stringify(bill.edits))}
      canEdit={canEdit}
      printedBy={user.name}
    />
  );
}
