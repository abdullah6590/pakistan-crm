// src/app/api/customer-payments/route.ts - Customer Payment management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { customerPaymentSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search") || "";

  const payments = await prisma.customerPayment.findMany({
    where: {
      AND: [
        customerId ? { customerId } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
        search ? { customer: { name: { contains: search } } } : {},
      ],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { date: "desc" },
  });

  const totals = await prisma.customerPayment.aggregate({
    _sum: { amount: true },
    _count: true,
    ...(customerId ? { where: { customerId } } : {}),
  });

  return NextResponse.json({
    payments,
    stats: {
      totalReceived: totals._sum.amount || 0,
      totalPayments: totals._count,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validation = customerPaymentSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 400 });
  }

  const data = validation.data;

  const payment = await prisma.customerPayment.create({
    data: {
      customerId: data.customerId,
      amount: data.amount,
      paymentMethod: data.paymentMethod as any,
      chequeNumber: data.chequeNumber || null,
      bankName: data.bankName || null,
      date: data.date || new Date(),
      notes: data.notes || null,
      saleId: data.saleId || null,
      userId: user.id,
    },
  });

  // Update customer balance
  await prisma.customer.update({
    where: { id: data.customerId },
    data: { balanceDue: { decrement: data.amount } },
  });

  // Create finance record
  await prisma.finance.create({
    data: {
      transactionRef: `TXN-CP-${Date.now()}`,
      type: "INCOME",
      category: "COMPONENT_SALE",
      amount: data.amount,
      description: `Payment received from customer`,
      paymentMethod: data.paymentMethod,
      reference: `Customer Payment`,
      referenceId: payment.id,
      userId: user.id,
    },
  });

  return NextResponse.json({ success: true, payment }, { status: 201 });
}
