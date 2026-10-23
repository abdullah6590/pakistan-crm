// src/app/api/accounts/[id]/route.ts - Individual financial account CRUD
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser, canManageFinance } from "@/lib/auth";
import { financialAccountSchema } from "@/lib/validations";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("accounts", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { id } = await params;
  const account = await prisma.financialAccount.findUnique({
    where: { id },
    include: {
      transfersFrom: { orderBy: { date: "desc" }, take: 10 },
      transfersTo: { orderBy: { date: "desc" }, take: 10 },
    },
  });

  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ account });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("accounts", "write");
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!canManageFinance(user.role)) return NextResponse.json({ error: "Forbidden: Not authorized to modify accounts" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();

  const account = await prisma.financialAccount.update({
    where: { id },
    data: {
      name: body.name,
      type: body.type,
      accountNumber: body.accountNumber || null,
      bankName: body.bankName || null,
      currentBalance: body.currentBalance !== undefined ? body.currentBalance : undefined,
      notes: body.notes || null,
      isActive: body.isActive !== undefined ? body.isActive : undefined,
    },
  });

  return NextResponse.json({ success: true, account });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("accounts", "delete");
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!canManageFinance(user.role)) return NextResponse.json({ error: "Forbidden: Not authorized to delete accounts" }, { status: 403 });

  const { id } = await params;
  await prisma.financialAccount.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
