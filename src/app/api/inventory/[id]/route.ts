// src/app/api/inventory/[id]/route.ts - Single component management
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const component = await prisma.component.findUnique({
    where: { id },
    include: {
      category: true,
      supplier: true,
      inventoryHistory: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });
  return NextResponse.json({ component });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "INVENTORY_MANAGER") {
    return NextResponse.json({ error: "Forbidden: Not authorized to modify inventory" }, { status: 403 });
  }

  const body = await request.json();
  const existing = await prisma.component.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Component not found" }, { status: 404 });

  // Track quantity change
  if (body.quantity !== undefined && body.quantity !== existing.quantity) {
    const diff = body.quantity - existing.quantity;
    await prisma.inventoryHistory.create({
      data: {
        componentId: id,
        type: diff > 0 ? "ADD" : "REMOVE",
        quantity: Math.abs(diff),
        balanceAfter: body.quantity,
        reference: "Manual adjustment",
        performedBy: user.id,
      },
    });
  }

  const component = await prisma.component.update({
    where: { id },
    data: body,
    include: { category: true, supplier: true },
  });

  return NextResponse.json({ success: true, component });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const component = await prisma.component.findUnique({
      where: { id },
      include: {
        _count: { select: { saleItems: true, purchaseItems: true, projectComponents: true } }
      }
    });

    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    if (component._count.saleItems > 0 || component._count.purchaseItems > 0 || component._count.projectComponents > 0) {
      return NextResponse.json({ error: "Cannot delete component because it is used in sales, purchases, or projects." }, { status: 400 });
    }

    // Delete history first (Cascade)
    await prisma.inventoryHistory.deleteMany({ where: { componentId: id } });
    
    // Delete component
    await prisma.component.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete component error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete component" }, { status: 500 });
  }
}