// src/app/api/finance/route.ts - Finance management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateTransactionRef } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const category = searchParams.get("category");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const records = await prisma.finance.findMany({
    where: {
      AND: [
        type ? { type: type as any } : {},
        category ? { category: category as any } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
      ],
    },
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
  });

  // Aggregations
  const income = await prisma.finance.aggregate({
    _sum: { amount: true },
    where: { type: "INCOME" },
  });
  const expense = await prisma.finance.aggregate({
    _sum: { amount: true },
    where: { type: "EXPENSE" },
  });

  return NextResponse.json({
    records,
    summary: {
      totalIncome: income._sum.amount || 0,
      totalExpense: expense._sum.amount || 0,
      netProfit: (income._sum.amount || 0) - (expense._sum.amount || 0),
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const record = await prisma.finance.create({
    data: {
      transactionRef: generateTransactionRef(Date.now() % 100000),
      type: body.type,
      category: body.category,
      amount: body.amount,
      description: body.description || "",
      paymentMethod: body.paymentMethod || null,
      reference: body.reference || null,
      referenceId: body.referenceId || null,
      date: body.date ? new Date(body.date) : new Date(),
      userId: user.userId,
    },
  });

  return NextResponse.json({ success: true, record }, { status: 201 });
}