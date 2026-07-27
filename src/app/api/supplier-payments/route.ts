// src/app/api/supplier-payments/route.ts - Supplier Payment management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { supplierPaymentSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const supplierId = searchParams.get("supplierId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search") || "";

  const payments = await prisma.supplierPayment.findMany({
    where: {
      AND: [
        supplierId ? { supplierId } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
        search ? { supplier: { name: { contains: search } } } : {},
      ],
    },
    include: {
      supplier: { select: { id: true, name: true, company: true, phone: true } },
    },
    orderBy: { date: "desc" },
  });

  const totals = await prisma.supplierPayment.aggregate({
    _sum: { amount: true },
    _count: true,
    ...(supplierId ? { where: { supplierId } } : {}),
  });

  return NextResponse.json({
    payments,
    stats: {
      totalPaid: totals._sum.amount || 0,
      totalPayments: totals._count,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validation = supplierPaymentSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 400 });
  }

  const data = validation.data;

  // Create supplier payment
  const payment = await prisma.supplierPayment.create({
    data: {
      supplierId: data.supplierId,
      amount: data.amount,
      paymentMethod: data.paymentMethod as any,
      chequeNumber: data.chequeNumber || null,
      bankName: data.bankName || null,
      date: data.date || new Date(),
      notes: data.notes || null,
      purchaseId: data.purchaseId || null,
      userId: user.id,
    },
  });

  // Update supplier balance
  await prisma.supplier.update({
    where: { id: data.supplierId },
    data: { balanceDue: { decrement: data.amount } },
  });

  // Create finance record
  await prisma.finance.create({
    data: {
      transactionRef: `TXN-SP-${Date.now()}`,
      type: "EXPENSE",
      category: "COMPONENT_PURCHASE",
      amount: data.amount,
      description: `Payment to supplier`,
      paymentMethod: data.paymentMethod,
      reference: `Supplier Payment`,
      referenceId: payment.id,
      userId: user.id,
    },
  });

  return NextResponse.json({ success: true, payment }, { status: 201 });
}
