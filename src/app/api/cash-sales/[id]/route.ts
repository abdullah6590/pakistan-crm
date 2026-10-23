// src/app/api/cash-sales/[id]/route.ts - Individual cash sale CRUD
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("cashSales", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { id } = await params;
  const sale = await prisma.cashSale.findUnique({ where: { id } });
  if (!sale) return NextResponse.json({ error: "Cash sale not found" }, { status: 404 });
  return NextResponse.json({ sale });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("cashSales", "delete");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { id } = await params;
  const sale = await prisma.cashSale.findUnique({ where: { id } });
  if (!sale) return NextResponse.json({ error: "Cash sale not found" }, { status: 404 });

  await prisma.cashSale.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
