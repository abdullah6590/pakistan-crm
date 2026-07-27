// src/app/api/expenditures/route.ts - Expenditure (Daily Expenses) management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { expenditureSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search") || "";

  const expenditures = await prisma.expenditure.findMany({
    where: {
      AND: [
        category ? { category } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
        search ? { description: { contains: search } } : {},
      ],
    },
    orderBy: { date: "desc" },
  });

  // Category-wise aggregation
  const categoryTotals = await prisma.expenditure.groupBy({
    by: ["category"],
    _sum: { amount: true },
    _count: true,
  });

  const totalExpense = expenditures.reduce((sum, e) => sum + e.amount, 0);

  return NextResponse.json({
    expenditures,
    stats: {
      totalExpense,
      totalRecords: expenditures.length,
      categoryBreakdown: categoryTotals.map(c => ({
        category: c.category,
        total: c._sum.amount || 0,
        count: c._count,
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validation = expenditureSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 400 });
  }

  const data = validation.data;

  const expenditure = await prisma.expenditure.create({
    data: {
      category: data.category,
      amount: data.amount,
      description: data.description,
      date: data.date || new Date(),
      accountId: data.accountId || null,
      userId: user.id,
    },
  });

  // Create finance record
  await prisma.finance.create({
    data: {
      transactionRef: `TXN-EXP-${Date.now()}`,
      type: "EXPENSE",
      category: data.category,
      amount: data.amount,
      description: data.description,
      paymentMethod: "CASH",
      reference: "Expenditure",
      referenceId: expenditure.id,
      userId: user.id,
      date: data.date || new Date(),
    },
  });

  // Deduct from linked account if specified
  if (data.accountId) {
    await prisma.financialAccount.update({
      where: { id: data.accountId },
      data: { currentBalance: { decrement: data.amount } },
    });
  }

  return NextResponse.json({ success: true, expenditure }, { status: 201 });
}
