// src/app/api/partners/route.ts - Partner management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const partners = await prisma.partner.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ partners });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const partner = await prisma.partner.create({
    data: {
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      investmentAmount: body.investmentAmount || 0,
      profitSharePercent: body.profitSharePercent || 0,
      notes: body.notes || null,
      isActive: true,
    },
  });

  return NextResponse.json({ success: true, partner }, { status: 201 });
}