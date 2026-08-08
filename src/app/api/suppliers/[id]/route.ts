// src/app/api/suppliers/[id]/route.ts - Single supplier management
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchases: { orderBy: { createdAt: "desc" }, take: 20 },
      components: { select: { id: true, name: true, sku: true, quantity: true } },
    },
  });

  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  return NextResponse.json({ supplier });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden: Only ADMIN can modify suppliers" }, { status: 403 });

  const body = await request.json();
  const supplier = await prisma.supplier.update({ where: { id }, data: body });
  return NextResponse.json({ success: true, supplier });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden: Only ADMIN can delete suppliers" }, { status: 403 });

  await prisma.supplier.delete({ where: { id } });
  return NextResponse.json({ success: true });
}