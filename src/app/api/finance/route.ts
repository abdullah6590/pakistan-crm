// src/app/api/finance/route.ts - Finance management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { generateTransactionRef } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const auth = await authorize("finance", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const category = searchParams.get("category");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const skip = (page - 1) * limit;

  const records = await prisma.finance.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { description: { contains: search } },
            { transactionRef: { contains: search } },
          ],
        } : {},
        type ? { type: type as any } : {},
        category ? { category: category as any } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
      ],
    },
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
    skip,
    take: limit,
  });

  const totalRecords = await prisma.finance.count({
    where: {
      AND: [
        search ? {
          OR: [
            { description: { contains: search } },
            { transactionRef: { contains: search } },
          ],
        } : {},
        type ? { type: type as any } : {},
        category ? { category: category as any } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
      ],
    },
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
    pagination: {
      total: totalRecords,
      pages: Math.ceil(totalRecords / limit),
      page,
      limit,
    },
    summary: {
      totalIncome: income._sum.amount || 0,
      totalExpense: expense._sum.amount || 0,
      netProfit: (income._sum.amount || 0) - (expense._sum.amount || 0),
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize("finance", "write");
    if (auth.response) return auth.response;
    const user = auth.user;

    const body = await request.json();
    
    // Strict amount validation
    const amount = parseFloat(body.amount);
    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      throw new Error("Invalid financial amount. Must be a positive finite number.");
    }

    // Strict date validation
    let transactionDate = new Date();
    if (body.date) {
      transactionDate = new Date(body.date);
      if (isNaN(transactionDate.getTime())) {
        throw new Error("Invalid transaction date format.");
      }
    }

    // Enforce valid categories for income and expense (basic check)
    if (!body.type || !body.category) {
      throw new Error("Missing required financial fields (type, category).");
    }

    const record = await prisma.finance.create({
      data: {
        transactionRef: generateTransactionRef(Date.now() % 100000),
        type: body.type,
        category: body.category,
        amount: amount,
        description: body.description || "",
        paymentMethod: body.paymentMethod || "CASH",
        reference: body.reference || null,
        referenceId: body.referenceId || null,
        date: transactionDate,
        userId: user.id,
      },
    });

    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}