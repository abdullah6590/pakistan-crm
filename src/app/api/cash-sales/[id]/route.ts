// src/app/api/cash-sales/[id]/route.ts - Individual cash sale CRUD
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sale = await prisma.cashSale.findUnique({ where: { id } });
  if (!sale) return NextResponse.json({ error: "Cash sale not found" }, { status: 404 });
  return NextResponse.json({ sale });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sale = await prisma.cashSale.findUnique({ where: { id } });
  if (!sale) return NextResponse.json({ error: "Cash sale not found" }, { status: 404 });

  await prisma.cashSale.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
