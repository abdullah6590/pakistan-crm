// src/app/api/partners/[id]/route.ts - Single partner management
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  return NextResponse.json({ partner });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  // Handle withdrawal
  if (body.withdrawAmount && body.withdrawAmount > 0) {
    const partner = await prisma.partner.findUnique({ where: { id } });
    if (partner) {
      body.totalWithdrawals = (partner.totalWithdrawals || 0) + body.withdrawAmount;
      delete body.withdrawAmount;
    }
  }

  const partner = await prisma.partner.update({ where: { id }, data: body });
  return NextResponse.json({ success: true, partner });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.partner.delete({ where: { id } });
  return NextResponse.json({ success: true });
}