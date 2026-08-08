// src/app/api/purchases/[id]/route.ts
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
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { component: { select: { id: true, name: true, sku: true } } } },
      user: { select: { name: true } },
    },
  });

  if (!purchase) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  return NextResponse.json({ purchase });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.purchase.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });

  // Authorization Check: Only ADMIN or the creator can modify
  if (user.role !== "ADMIN" && existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden: Not authorized to modify this purchase" }, { status: 403 });
  }

  const body = await request.json();
  const purchase = await prisma.purchase.update({
    where: { id },
    data: {
      paymentStatus: body.paymentStatus,
      paidAmount: body.paidAmount,
      notes: body.notes,
    },
  });

  return NextResponse.json({ success: true, purchase });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.purchase.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });

  // Reverse inventory increments
  const items = await prisma.purchaseItem.findMany({ where: { purchaseId: id } });
  for (const item of items) {
    await prisma.component.update({
      where: { id: item.componentId },
      data: {
        quantity: { decrement: item.quantity },
        totalPurchased: { decrement: item.quantity },
      },
    });
  }

  await prisma.purchase.delete({ where: { id } });
  return NextResponse.json({ success: true, message: "Purchase deleted" });
}