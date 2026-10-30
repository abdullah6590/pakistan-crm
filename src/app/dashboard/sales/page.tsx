// src/app/dashboard/sales/page.tsx - Sales list on Books (Report 28): every current bill with what it has received
// and still owes. Bills from before the move are under Sales → Older bills.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listBills } from "@/lib/sales/books-queries";
import BillsClient from "./bills-client";

export const dynamic = "force-dynamic";

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "sales", "read")) redirect("/dashboard");
  const p = await searchParams;
  const [result, customers, olderCount] = await Promise.all([
    listBills(prisma, { search: p.search, customerId: p.customerId, status: p.status, from: p.from, to: p.to, page: Number(p.page) || 1 }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.sale.count(),
  ]);
  return (
    <BillsClient
      rows={result.rows}
      stats={result.stats}
      pagination={result.pagination}
      customers={customers}
      olderCount={olderCount}
      canReceive={can(user.role, "customerPayments", "write")}
    />
  );
}
