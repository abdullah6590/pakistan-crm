// src/app/dashboard/purchases/page.tsx - Purchases on Books (Report 30): every current purchase bill with what was paid
// and is still payable. Purchases entered before the move are under Purchases → Older purchases.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady } from "@/lib/accounting/server";
import { listPurchaseBills } from "@/lib/purchases/queries";
import PurchaseBillsClient from "./purchase-bills-client";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "purchases", "read")) redirect("/dashboard");
  await accountingReady();
  const p = await searchParams;
  const [result, suppliers, olderCount] = await Promise.all([
    listPurchaseBills(prisma, { search: p.search, supplierId: p.supplierId, status: p.status, from: p.from, to: p.to, page: Number(p.page) || 1 }),
    prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.purchase.count(),
  ]);
  return (
    <PurchaseBillsClient
      rows={result.rows}
      stats={result.stats}
      pagination={result.pagination}
      suppliers={suppliers}
      olderCount={olderCount}
      canCreate={can(user.role, "purchases", "write")}
      canPay={can(user.role, "supplierPayments", "write")}
      canSeePayments={can(user.role, "supplierPayments", "read")}
    />
  );
}
