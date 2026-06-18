// src/app/api/sales/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { component: { select: { id: true, name: true, sku: true } } } },
      user: { select: { name: true } },
    },
  });

  if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  return NextResponse.json({ sale });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.sale.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

  const body = await request.json();
  const sale = await prisma.sale.update({
    where: { id },
    data: {
      paymentStatus: body.paymentStatus,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
    },
  });

  return NextResponse.json({ success: true, sale });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.sale.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

  // Reverse inventory deductions
  const items = await prisma.saleItem.findMany({ where: { saleId: id } });
  for (const item of items) {
    await prisma.component.update({
      where: { id: item.componentId },
      data: {
        quantity: { increment: item.quantity },
        totalSold: { decrement: item.quantity },
      },
    });
  }

  await prisma.sale.delete({ where: { id } });
  return NextResponse.json({ success: true, message: "Sale deleted" });
}