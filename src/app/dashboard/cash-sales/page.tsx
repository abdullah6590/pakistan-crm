// src/app/dashboard/cash-sales/page.tsx - Cash Sales (Counter Sale) server page
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import CashSalesClient from "./cash-sales-client";

export default async function CashSalesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const sales = await prisma.cashSale.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const todayStats = await prisma.cashSale.aggregate({
    _sum: { amount: true },
    _count: true,
    where: { date: { gte: today, lt: tomorrow } },
  });

  const allStats = await prisma.cashSale.aggregate({
    _sum: { amount: true },
    _count: true,
  });

  return (
    <CashSalesClient
      sales={JSON.parse(JSON.stringify(sales))}
      todayStats={{ total: todayStats._sum.amount || 0, count: todayStats._count }}
      allStats={{ total: allStats._sum.amount || 0, count: allStats._count }}
    />
  );
}
