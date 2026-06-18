// src/app/api/dashboard/route.ts - Dashboard stats API
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { startOfMonth, subMonths, startOfYear } from "date-fns";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const yearStart = startOfYear(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = new Date(monthStart.getTime() - 1);

    // ─── Counts ─────────────────────────────────────────────
    const [
      totalComponents,
      lowStockCount,
      totalProjects,
      activeProjects,
      totalCustomers,
      totalSuppliers,
      totalPartners,
    ] = await Promise.all([
      prisma.component.count(),
      prisma.component.count({ where: { quantity: { lte: prisma.component.fields.minQuantity }, isActive: true } }),
      prisma.project.count(),
      prisma.project.count({ where: { status: { in: ["PLANNING", "IN_PROGRESS"] } } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.supplier.count({ where: { isActive: true } }),
      prisma.partner.count({ where: { isActive: true } }),
    ]);

    // ─── Financial Summary ──────────────────────────────────
    const [monthIncome, monthExpense, yearIncome, yearExpense] = await Promise.all([
      prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "INCOME", date: { gte: monthStart } } }),
      prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", date: { gte: monthStart } } }),
      prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "INCOME", date: { gte: yearStart } } }),
      prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", date: { gte: yearStart } } }),
    ]);

    // ─── Sales Summary ─────────────────────────────────────
    const [monthSales, yearSales, lastMonthSales] = await Promise.all([
      prisma.sale.aggregate({ _sum: { total: true, profit: true }, where: { createdAt: { gte: monthStart } } }),
      prisma.sale.aggregate({ _sum: { total: true, profit: true }, where: { createdAt: { gte: yearStart } } }),
      prisma.sale.aggregate({ _sum: { total: true }, where: { createdAt: { gte: lastMonthStart, lt: monthStart } } }),
    ]);

    // ─── Purchase Summary ──────────────────────────────────
    const [monthPurchases, yearPurchases] = await Promise.all([
      prisma.purchase.aggregate({ _sum: { total: true }, where: { createdAt: { gte: monthStart } } }),
      prisma.purchase.aggregate({ _sum: { total: true }, where: { createdAt: { gte: yearStart } } }),
    ]);

    // ─── Recent Sales ──────────────────────────────────────
    const recentSales = await prisma.sale.findMany({
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
    });

    // ─── Recent Projects ───────────────────────────────────
    const recentProjects = await prisma.project.findMany({
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
        user: { select: { name: true } },
      },
    });

    // ─── Monthly Revenue Chart (last 6 months) ─────────────
    const monthlyData: { month: string; income: number; expense: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = startOfMonth(subMonths(now, i));
      const mEnd = i === 0 ? now : startOfMonth(subMonths(now, i - 1));
      const [inc, exp] = await Promise.all([
        prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "INCOME", date: { gte: mStart, lt: mEnd } } }),
        prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", date: { gte: mStart, lt: mEnd } } }),
      ]);
      monthlyData.push({
        month: mStart.toLocaleString("default", { month: "short" }),
        income: inc._sum.amount || 0,
        expense: exp._sum.amount || 0,
      });
    }

    // ─── Inventory Value ───────────────────────────────────
    const inventoryValue = await prisma.component.aggregate({
      _sum: { quantity: true },
      where: { isActive: true },
    });
    const totalInventoryCost = await prisma.component.aggregate({
      _sum: { quantity: true, unitCost: true },
      where: { isActive: true },
    });

    // Calculate inventory value (quantity * unitCost per component)
    const components = await prisma.component.findMany({
      where: { isActive: true },
      select: { quantity: true, unitCost: true },
    });
    const inventoryTotalValue: number = components.reduce((sum: number, c) => sum + c.quantity * c.unitCost, 0);

    // ─── Top Selling Components ────────────────────────────
    const topComponents = await prisma.component.findMany({
      take: 5,
      orderBy: { totalSold: "desc" },
      select: { id: true, name: true, sku: true, totalSold: true, quantity: true, unitPrice: true },
    });

    // ─── Sales growth ──────────────────────────────────────
    const currentMonthSales = monthSales._sum.total || 0;
    const prevMonthSales = lastMonthSales._sum.total || 0;
    const salesGrowth = prevMonthSales > 0 ? ((currentMonthSales - prevMonthSales) / prevMonthSales) * 100 : 0;

    return NextResponse.json({
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
        yearIncome: yearIncome._sum.amount || 0,
        yearExpense: yearExpense._sum.amount || 0,
        yearProfit: (yearIncome._sum.amount || 0) - (yearExpense._sum.amount || 0),
      },
      sales: {
        monthTotal: currentMonthSales,
        monthProfit: monthSales._sum.profit || 0,
        yearTotal: yearSales._sum.total || 0,
        yearProfit: yearSales._sum.profit || 0,
        growth: Math.round(salesGrowth * 100) / 100,
      },
      purchases: {
        monthTotal: monthPurchases._sum.total || 0,
        yearTotal: yearPurchases._sum.total || 0,
      },
      inventory: {
        totalItems: inventoryValue._sum.quantity || 0,
        totalValue: inventoryTotalValue,
      },
      monthlyData,
      recentSales,
      recentProjects,
      topComponents,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 });
  }
}