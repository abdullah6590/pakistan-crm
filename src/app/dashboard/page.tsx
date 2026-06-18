// src/app/(dashboard)/page.tsx - Main Dashboard
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // Fetch dashboard data server-side
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalComponents,
    lowStockCount,
    totalProjects,
    activeProjects,
    totalCustomers,
    totalSuppliers,
    totalPartners,
    monthIncome,
    monthExpense,
    monthSales,
    monthlyFinances,
    recentSales,
    recentProjects,
    topComponents,
  ] = await Promise.all([
    prisma.component.count(),
    prisma.component.count({
      where: { quantity: { lte: 5 }, isActive: true },
    }),
    prisma.project.count(),
    prisma.project.count({
      where: { status: { in: ["PLANNING", "IN_PROGRESS"] } },
    }),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.partner.count({ where: { isActive: true } }),
    prisma.finance.aggregate({
      _sum: { amount: true },
      where: { type: "INCOME", date: { gte: monthStart } },
    }),
    prisma.finance.aggregate({
      _sum: { amount: true },
      where: { type: "EXPENSE", date: { gte: monthStart } },
    }),
    prisma.sale.aggregate({
      _sum: { total: true, profit: true },
      where: { createdAt: { gte: monthStart } },
    }),
    // Monthly breakdown for chart
    (async () => {
      const data: { month: string; income: number; expense: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = i === 0 ? now : new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const [inc, exp] = await Promise.all([
          prisma.finance.aggregate({
            _sum: { amount: true },
            where: { type: "INCOME", date: { gte: mStart, lt: mEnd } },
          }),
          prisma.finance.aggregate({
            _sum: { amount: true },
            where: { type: "EXPENSE", date: { gte: mStart, lt: mEnd } },
          }),
        ]);
        data.push({
          month: mStart.toLocaleString("default", { month: "short" }),
          income: inc._sum.amount || 0,
          expense: exp._sum.amount || 0,
        });
      }
      return data;
    })(),
    prisma.sale.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        paymentMethod: true,
        paymentStatus: true,
        createdAt: true,
        customer: { select: { name: true } },
        walkInName: true,
      },
    }),
    prisma.project.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        name: true,
        status: true,
        clientPayment: true,
        totalCost: true,
        profit: true,
        deadline: true,
        createdAt: true,
      },
    }),
    prisma.component.findMany({
      take: 5,
      orderBy: { totalSold: "desc" },
      select: { id: true, name: true, sku: true, totalSold: true, quantity: true, unitPrice: true },
    }),
  ]);

  const dashboardData = {
    counts: {
      components: totalComponents,
      lowStock: lowStockCount,
      projects: totalProjects,
      activeProjects,
      customers: totalCustomers,
      suppliers: totalSuppliers,
      partners: totalPartners,
    },
    finance: {
      monthIncome: monthIncome._sum.amount || 0,
      monthExpense: monthExpense._sum.amount || 0,
      monthProfit: (monthIncome._sum.amount || 0) - (monthExpense._sum.amount || 0),
    },
    sales: {
      monthTotal: monthSales._sum.total || 0,
      monthProfit: monthSales._sum.profit || 0,
    },
    monthlyData: monthlyFinances,
    recentSales,
    recentProjects,
    topComponents,
  };

  return <DashboardClient data={dashboardData} user={user} />;
}