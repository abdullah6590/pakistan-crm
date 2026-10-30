// src/app/(dashboard)/page.tsx - Main Dashboard
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { predictStockLevels, detectAnomalies } from "@/lib/ai-engine";
import DashboardClient from "./dashboard-client";
import { dashboardVisibility } from "@/lib/permissions";
import { booksSalesSince, recentBooksBills } from "@/lib/sales/books-queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // Sections are only queried for roles that may read the underlying module (audit R-SEC-1)
  const vis = dashboardVisibility(user.role);
  const zeroAmount = { _sum: { amount: 0 as number | null } };

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
    olderMonthSales,
    monthlyFinances,
    olderRecentSales,
    recentProjects,
    topComponents,
    allComponents, // for AI predictions
  ] = await Promise.all([
    prisma.component.count(),
    prisma.component.count({
      where: { quantity: { lte: 5 }, isActive: true },
    }),
    vis.projects ? prisma.project.count() : Promise.resolve(0),
    vis.projects ? prisma.project.count({
      where: { status: { in: ["PLANNING", "IN_PROGRESS"] } },
    }) : Promise.resolve(0),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.supplier.count({ where: { isActive: true } }),
    vis.partners ? prisma.partner.count({ where: { isActive: true } }) : Promise.resolve(0),
    vis.finance ? prisma.finance.aggregate({
      _sum: { amount: true },
      where: { type: "INCOME", date: { gte: monthStart } },
    }) : Promise.resolve(zeroAmount),
    vis.finance ? prisma.finance.aggregate({
      _sum: { amount: true },
      where: { type: "EXPENSE", date: { gte: monthStart } },
    }) : Promise.resolve(zeroAmount),
    vis.sales ? prisma.sale.aggregate({
      _sum: { total: true, profit: true },
      where: { createdAt: { gte: monthStart } },
    }) : Promise.resolve({ _sum: { total: 0 as number | null, profit: 0 as number | null } }),
    // Monthly breakdown for chart
    (async () => {
      if (!vis.finance) return [];
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
    !vis.sales ? Promise.resolve([]) : prisma.sale.findMany({
      take: 5, // bills from before Sales moved to Books (Report 28)
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
    !vis.projects ? Promise.resolve([]) : prisma.project.findMany({
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
    prisma.component.findMany({
      take: 100,
      orderBy: [
        { totalSold: "desc" },
      ],
      select: { id: true, name: true, quantity: true, minQuantity: true, totalSold: true, createdAt: true },
    }),
  ]);
  // Sales are Books bills since Report 28; bills made before the move are still counted
  const [booksMonth, booksRecent] = vis.sales
    ? await Promise.all([booksSalesSince(prisma, monthStart), recentBooksBills(prisma, 5)])
    : [{ total: 0, profit: 0, count: 0 }, []];
  const monthSales = { _sum: { total: (olderMonthSales._sum.total || 0) + booksMonth.total, profit: (olderMonthSales._sum.profit || 0) + booksMonth.profit } };
  const recentSales = [...booksRecent, ...olderRecentSales]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
    .map(({ id, invoiceNumber, total, paymentMethod, paymentStatus, createdAt, customer, walkInName }) => ({ id, invoiceNumber, total, paymentMethod, paymentStatus, createdAt, customer, walkInName }));

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
    aiPredictions: predictStockLevels(allComponents as any).slice(0, 5),
    aiAnomalies: detectAnomalies(recentSales.map(s => ({
      id: s.id,
      type: "sale",
      amount: s.total,
      customerName: s.customer?.name || s.walkInName || "Walk-in",
      timestamp: s.createdAt.toISOString(),
      isNewCustomer: !s.customer, // Simplified logic for walk-ins
    }))).slice(0, 3),
  };

  return <DashboardClient data={{ ...dashboardData, visibility: vis }} user={user} />;
}