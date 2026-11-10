// src/app/dashboard/cash-sales/page.tsx - Older cash sales: what the old Cash Sales screen saved, before cash sales moved
// to Books (2026-11-10). Read-only; new cash sales are entered on New sale with the walk-in customer.
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import CashSalesClient from "./cash-sales-client";

export const dynamic = "force-dynamic";

export default async function CashSalesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "cashSales", "read")) redirect("/dashboard");

  const [sales, allStats] = await Promise.all([
    prisma.cashSale.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.cashSale.aggregate({ _sum: { amount: true }, _count: true }),
  ]);

  return (
    <CashSalesClient
      sales={JSON.parse(JSON.stringify(sales))}
      allStats={{ total: allStats._sum.amount || 0, count: allStats._count }}
      canSell={can(user.role, "sales", "write")}
    />
  );
}
