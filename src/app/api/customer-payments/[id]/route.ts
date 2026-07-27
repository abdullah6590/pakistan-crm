// src/app/api/customer-payments/[id]/route.ts - Individual customer payment CRUD
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const payment = await prisma.customerPayment.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });

  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json({ payment });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const payment = await prisma.customerPayment.findUnique({ where: { id } });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  await prisma.customer.update({
    where: { id: payment.customerId },
    data: { balanceDue: { increment: payment.amount } },
  });

  await prisma.customerPayment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
