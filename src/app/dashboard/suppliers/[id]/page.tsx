// src/app/dashboard/suppliers/[id]/page.tsx - A supplier's profile (Report 30 §1): details, balance and payable, open
// bills, credit, purchase and payment history, returns and the change history.
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady, serialize } from "@/lib/accounting/server";
import { listPurchaseBills, supplierAccount, supplierPayments } from "@/lib/purchases/queries";
import { supplierHistory } from "@/lib/purchases/suppliers";
import SupplierProfile, { type Profile } from "./profile-client";

export const dynamic = "force-dynamic";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "suppliers", "read")) redirect("/dashboard");
  const { id } = await params;
  await accountingReady();
  const account = await supplierAccount(prisma, id);
  if (!account) notFound();
  const seePayments = can(user.role, "supplierPayments", "read");
  const [bills, payments, returns, history, opening] = await Promise.all([
    listPurchaseBills(prisma, { supplierId: id }, 500),
    seePayments ? supplierPayments(prisma, { supplierId: id, includeCancelled: true }) : [],
    account.partyAccountId
      ? prisma.accountingDocument.findMany({ where: { type: "PURCHASE_RETURN", partyAccountId: account.partyAccountId }, select: { id: true, docNo: true, date: true, total: true, status: true, returnOf: { select: { id: true, docNo: true } } }, orderBy: { date: "desc" } })
      : [],
    supplierHistory(prisma, account.supplier),
    account.partyAccountId ? prisma.accountingDocument.findFirst({ where: { type: "OPENING_BALANCE", partyAccountId: account.partyAccountId, status: "POSTED" }, select: { id: true, docNo: true, total: true, date: true } }) : null,
  ]);
  return (
    <SupplierProfile
      profile={serialize({ account, bills: bills.rows, payments, returns, history, opening }) as Profile}
      canEdit={can(user.role, "suppliers", "write")}
      canArchive={can(user.role, "suppliers", "delete")}
      canPay={can(user.role, "supplierPayments", "write")}
      canBuy={can(user.role, "purchases", "write")}
      canSeePayments={seePayments}
      isAdmin={user.role === "ADMIN"}
    />
  );
}
