// src/app/api/transfers/route.ts - Account Transfer management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { accountTransferSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const transfers = await prisma.accountTransfer.findMany({
    where: {
      AND: [
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
      ],
    },
    include: {
      fromAccount: { select: { id: true, name: true, type: true } },
      toAccount: { select: { id: true, name: true, type: true } },
    },
    orderBy: { date: "desc" },
  });

  const totals = await prisma.accountTransfer.aggregate({
    _sum: { amount: true },
    _count: true,
  });

  return NextResponse.json({
    transfers,
    stats: {
      totalTransferred: totals._sum.amount || 0,
      totalTransfers: totals._count,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validation = accountTransferSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 400 });
  }

  const data = validation.data;

  if (data.fromAccountId === data.toAccountId) {
    return NextResponse.json({ error: "Cannot transfer to the same account" }, { status: 400 });
  }

  // Check source has sufficient balance
  const sourceAccount = await prisma.financialAccount.findUnique({ where: { id: data.fromAccountId } });
  if (!sourceAccount) return NextResponse.json({ error: "Source account not found" }, { status: 404 });
  if (sourceAccount.currentBalance < data.amount) {
    return NextResponse.json({ error: "Insufficient balance in source account" }, { status: 400 });
  }

  // Create transfer and update both balances atomically
  const transfer = await prisma.accountTransfer.create({
    data: {
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      amount: data.amount,
      transferType: data.transferType as any,
      voucherNumber: data.voucherNumber || null,
      notes: data.notes || null,
      date: data.date || new Date(),
      userId: user.id,
    },
  });

  // Deduct from source
  await prisma.financialAccount.update({
    where: { id: data.fromAccountId },
    data: { currentBalance: { decrement: data.amount } },
  });

  // Add to destination
  await prisma.financialAccount.update({
    where: { id: data.toAccountId },
    data: { currentBalance: { increment: data.amount } },
  });

  return NextResponse.json({ success: true, transfer }, { status: 201 });
}
