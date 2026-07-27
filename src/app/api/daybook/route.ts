// src/app/api/daybook/route.ts - Daybook master ledger API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section") || "finance"; // supplier | customer | finance
  const entityId = searchParams.get("entityId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const dateFilter: any = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  if (section === "supplier") {
    // Supplier daybook: all suppliers with purchase/payment summaries
    const suppliers = await prisma.supplier.findMany({
      where: entityId ? { id: entityId } : { isActive: true },
      select: {
        id: true, name: true, company: true, phone: true,
        totalPurchased: true, balanceDue: true,
        _count: { select: { purchases: true, supplierPayments: true } },
      },
    });

    // Get purchases timeline
    const purchases = await prisma.purchase.findMany({
      where: {
        ...(entityId ? { supplierId: entityId } : {}),
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Get payments timeline
    const payments = await prisma.supplierPayment.findMany({
      where: {
        ...(entityId ? { supplierId: entityId } : {}),
        ...(hasDateFilter ? { date: dateFilter } : {}),
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 100,
    });

    // Build combined ledger
    const ledger = [
      ...purchases.map(p => ({
        id: p.id, date: p.createdAt, type: "PURCHASE" as const,
        description: `Purchase ${p.poNumber}`, debit: p.total, credit: 0,
        reference: p.poNumber, entityName: p.supplier.name,
      })),
      ...payments.map(p => ({
        id: p.id, date: p.date, type: "PAYMENT" as const,
        description: `Payment - ${p.paymentMethod}`, debit: 0, credit: p.amount,
        reference: p.chequeNumber || null, entityName: p.supplier.name,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate running balance
    let runningBalance = 0;
    const ledgerWithBalance = [...ledger].reverse().map(entry => {
      runningBalance += entry.debit - entry.credit;
      return { ...entry, balance: runningBalance };
    }).reverse();

    // Monthly aggregation for charts
    const monthlyData: Record<string, { purchases: number; payments: number }> = {};
    purchases.forEach(p => {
      const key = `${new Date(p.createdAt).getFullYear()}-${String(new Date(p.createdAt).getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyData[key]) monthlyData[key] = { purchases: 0, payments: 0 };
      monthlyData[key].purchases += p.total;
    });
    payments.forEach(p => {
      const key = `${new Date(p.date).getFullYear()}-${String(new Date(p.date).getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyData[key]) monthlyData[key] = { purchases: 0, payments: 0 };
      monthlyData[key].payments += p.amount;
    });

    const chartData = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    return NextResponse.json({
      section: "supplier",
      suppliers,
      ledger: ledgerWithBalance,
      chartData,
      summary: {
        totalPurchases: purchases.reduce((s, p) => s + p.total, 0),
        totalPayments: payments.reduce((s, p) => s + p.amount, 0),
        totalBalance: suppliers.reduce((s, sup) => s + sup.balanceDue, 0),
      },
    });
  }

  if (section === "customer") {
    const customers = await prisma.customer.findMany({
      where: entityId ? { id: entityId } : { isActive: true },
      select: {
        id: true, name: true, phone: true,
        totalPurchased: true, balanceDue: true,
        _count: { select: { sales: true, customerPayments: true } },
      },
    });

    const sales = await prisma.sale.findMany({
      where: {
        ...(entityId ? { customerId: entityId } : {}),
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const payments = await prisma.customerPayment.findMany({
      where: {
        ...(entityId ? { customerId: entityId } : {}),
        ...(hasDateFilter ? { date: dateFilter } : {}),
      },
      include: { customer: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 100,
    });

    const ledger = [
      ...sales.map(s => ({
        id: s.id, date: s.createdAt, type: "SALE" as const,
        description: `Sale ${s.invoiceNumber}`, debit: s.total, credit: 0,
        reference: s.invoiceNumber, entityName: s.customer?.name || s.walkInName || "Walk-in",
      })),
      ...payments.map(p => ({
        id: p.id, date: p.date, type: "RECEIPT" as const,
        description: `Payment received - ${p.paymentMethod}`, debit: 0, credit: p.amount,
        reference: p.chequeNumber || null, entityName: p.customer.name,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let runningBalance = 0;
    const ledgerWithBalance = [...ledger].reverse().map(entry => {
      runningBalance += entry.debit - entry.credit;
      return { ...entry, balance: runningBalance };
    }).reverse();

    const monthlyData: Record<string, { sales: number; receipts: number }> = {};
    sales.forEach(s => {
      const key = `${new Date(s.createdAt).getFullYear()}-${String(new Date(s.createdAt).getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyData[key]) monthlyData[key] = { sales: 0, receipts: 0 };
      monthlyData[key].sales += s.total;
    });
    payments.forEach(p => {
      const key = `${new Date(p.date).getFullYear()}-${String(new Date(p.date).getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyData[key]) monthlyData[key] = { sales: 0, receipts: 0 };
      monthlyData[key].receipts += p.amount;
    });

    const chartData = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    return NextResponse.json({
      section: "customer",
      customers,
      ledger: ledgerWithBalance,
      chartData,
      summary: {
        totalSales: sales.reduce((s, sale) => s + sale.total, 0),
        totalReceived: payments.reduce((s, p) => s + p.amount, 0),
        totalReceivable: customers.reduce((s, c) => s + c.balanceDue, 0),
      },
    });
  }

  // Finance section (default)
  const income = await prisma.finance.aggregate({
    _sum: { amount: true },
    where: { type: "INCOME", ...(hasDateFilter ? { date: dateFilter } : {}) },
  });
  const expense = await prisma.finance.aggregate({
    _sum: { amount: true },
    where: { type: "EXPENSE", ...(hasDateFilter ? { date: dateFilter } : {}) },
  });

  const accounts = await prisma.financialAccount.findMany({
    where: { isActive: true },
  });

  const recentTransactions = await prisma.finance.findMany({
    where: hasDateFilter ? { date: dateFilter } : {},
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: 100,
  });

  const expenditures = await prisma.expenditure.groupBy({
    by: ["category"],
    _sum: { amount: true },
    ...(hasDateFilter ? { where: { date: dateFilter } } : {}),
  });

  // Monthly P&L
  const allFinance = await prisma.finance.findMany({
    where: hasDateFilter ? { date: dateFilter } : {},
    select: { type: true, amount: true, date: true },
  });

  const monthlyPL: Record<string, { income: number; expense: number }> = {};
  allFinance.forEach(f => {
    const key = `${new Date(f.date).getFullYear()}-${String(new Date(f.date).getMonth() + 1).padStart(2, "0")}`;
    if (!monthlyPL[key]) monthlyPL[key] = { income: 0, expense: 0 };
    if (f.type === "INCOME") monthlyPL[key].income += f.amount;
    else monthlyPL[key].expense += f.amount;
  });

  const chartData = Object.entries(monthlyPL)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data, profit: data.income - data.expense }));

  return NextResponse.json({
    section: "finance",
    transactions: recentTransactions,
    accounts,
    chartData,
    expenseBreakdown: expenditures.map(e => ({
      category: e.category,
      total: e._sum.amount || 0,
    })),
    summary: {
      totalIncome: income._sum.amount || 0,
      totalExpense: expense._sum.amount || 0,
      netProfit: (income._sum.amount || 0) - (expense._sum.amount || 0),
      cashInHand: accounts.filter(a => a.type === "CASH").reduce((s, a) => s + a.currentBalance, 0),
      bankBalance: accounts.filter(a => a.type === "BANK").reduce((s, a) => s + a.currentBalance, 0),
    },
  });
}
