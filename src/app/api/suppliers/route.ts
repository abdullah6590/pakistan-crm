// src/app/api/suppliers/route.ts - Supplier management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";

  const suppliers = await prisma.supplier.findMany({
    where: search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    } : {},
    orderBy: { totalPurchased: "desc" },
    include: { _count: { select: { purchases: true, components: true } } },
  });

  return NextResponse.json({ suppliers });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const supplier = await prisma.supplier.create({
    data: {
      name: body.name,
      company: body.company || null,
      phone: body.phone || null,
      email: body.email || null,
      city: body.city || null,
      country: body.country || "Pakistan",
    },
  });

  return NextResponse.json({ success: true, supplier }, { status: 201 });
}