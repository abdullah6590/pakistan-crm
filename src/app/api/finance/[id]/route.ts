// src/app/api/finance/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthUser, isAdmin } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const record = await prisma.finance.findUnique({
    where: { id },
    include: { user: { select: { name: true } } },
  });

  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  return NextResponse.json({ record });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.finance.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Record not found" }, { status: 404 });

  const body = await request.json();
  const record = await prisma.finance.update({
    where: { id },
    data: {
      category: body.category,
      amount: body.amount,
      description: body.description,
      paymentMethod: body.paymentMethod,
      date: body.date ? new Date(body.date) : undefined,
    },
  });

  return NextResponse.json({ success: true, record });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.finance.delete({ where: { id } });
  return NextResponse.json({ success: true, message: "Record deleted" });
}