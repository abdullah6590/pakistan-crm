// src/app/api/supplier-payments/[id]/route.ts - Individual supplier payment CRUD
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const payment = await prisma.supplierPayment.findUnique({
    where: { id },
    include: { supplier: { select: { id: true, name: true, company: true } } },
  });

  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json({ payment });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const payment = await prisma.supplierPayment.findUnique({ where: { id } });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  // Reverse the balance update
  await prisma.supplier.update({
    where: { id: payment.supplierId },
    data: { balanceDue: { increment: payment.amount } },
  });

  await prisma.supplierPayment.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
