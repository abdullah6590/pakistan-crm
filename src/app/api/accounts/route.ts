// src/app/api/accounts/route.ts - Financial Account management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { financialAccountSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.financialAccount.findMany({
    orderBy: { createdAt: "desc" },
  });

  // Calculate summary
  const totalBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);
  const bankBalance = accounts.filter(a => a.type === "BANK").reduce((sum, a) => sum + a.currentBalance, 0);
  const cashBalance = accounts.filter(a => a.type === "CASH").reduce((sum, a) => sum + a.currentBalance, 0);
  const walletBalance = accounts.filter(a => a.type === "DIGITAL_WALLET").reduce((sum, a) => sum + a.currentBalance, 0);

  return NextResponse.json({
    accounts,
    summary: { totalBalance, bankBalance, cashBalance, walletBalance },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validation = financialAccountSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 400 });
  }

  const data = validation.data;

  const account = await prisma.financialAccount.create({
    data: {
      name: data.name,
      type: data.type as any,
      accountNumber: data.accountNumber || null,
      bankName: data.bankName || null,
      currentBalance: data.currentBalance || 0,
      notes: data.notes || null,
    },
  });

  return NextResponse.json({ success: true, account }, { status: 201 });
}
