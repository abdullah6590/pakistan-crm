// src/app/api/customers/route.ts - Customer management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";

  const customers = await prisma.customer.findMany({
    where: search ? {
      OR: [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
        { city: { contains: search } },
      ],
    } : {},
    orderBy: { totalPurchased: "desc" },
    include: { _count: { select: { sales: true } } },
  });

  return NextResponse.json({ customers });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const customer = await prisma.customer.create({
    data: {
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      city: body.city || null,
      address: body.address || null,
    },
  });

  return NextResponse.json({ success: true, customer }, { status: 201 });
}