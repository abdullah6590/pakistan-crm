// src/app/dashboard/purchases/[id]/page.tsx - One purchase bill (Report 30), or a purchase from before the move to Books
// (shown read-only).
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { serialize } from "@/lib/accounting/server";
import { loadPurchaseBill } from "@/lib/purchases/queries";
import { mayEditBill } from "@/lib/purchases/books-purchases";
import PurchaseBillClient, { type PurchaseBill } from "./purchase-bill-client";
import OlderPurchase from "./older-purchase";

export const dynamic = "force-dynamic";

export default async function PurchaseBillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "purchases", "read")) redirect("/dashboard");
  const { id } = await params;
  const bill = await loadPurchaseBill(prisma, id);
  if (!bill) {
    const older = await prisma.purchase.findUnique({
      where: { id },
      include: { supplier: { select: { name: true, phone: true } }, items: { include: { component: { select: { name: true, sku: true } } } }, user: { select: { name: true } } },
    });
    if (!older) notFound();
    return <OlderPurchase purchase={serialize(older) as never} />;
  }
  const posted = bill.doc.status === "POSTED";
  const actor = { id: user.id, role: user.role };
  return (
    <PurchaseBillClient
      bill={serialize(bill) as PurchaseBill}
      canEdit={posted && can(user.role, "purchases", "write") && mayEditBill(actor, bill.doc)}
      canPay={posted && can(user.role, "supplierPayments", "write")}
      canReturn={posted && can(user.role, "purchases", "write")}
      canCancel={posted && can(user.role, "purchases", "delete")}
      canAttach={can(user.role, "purchases", "write")}
      canSeePayments={can(user.role, "supplierPayments", "read")}
    />
  );
}
