// src/app/api/expenditures/[id]/route.ts - Individual expenditure CRUD
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const expenditure = await prisma.expenditure.findUnique({ where: { id } });
  if (!expenditure) return NextResponse.json({ error: "Expenditure not found" }, { status: 404 });
  return NextResponse.json({ expenditure });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const expenditure = await prisma.expenditure.update({
    where: { id },
    data: {
      category: body.category,
      amount: body.amount,
      description: body.description,
      date: body.date ? new Date(body.date) : undefined,
    },
  });

  return NextResponse.json({ success: true, expenditure });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const expenditure = await prisma.expenditure.findUnique({ where: { id } });
  if (!expenditure) return NextResponse.json({ error: "Expenditure not found" }, { status: 404 });

  // Reverse account deduction if applicable
  if (expenditure.accountId) {
    await prisma.financialAccount.update({
      where: { id: expenditure.accountId },
      data: { currentBalance: { increment: expenditure.amount } },
    });
  }

  await prisma.expenditure.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
