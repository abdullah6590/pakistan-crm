// src/app/api/suppliers/route.ts - Supplier management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await authorize("suppliers", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";

  const suppliers = await prisma.supplier.findMany({
    where: search ? {
      OR: [
        { name: { contains: search } },
        { company: { contains: search } },
        { phone: { contains: search } },
      ],
    } : {},
    orderBy: { totalPurchased: "desc" },
    include: { _count: { select: { purchases: true, components: true } } },
  });

  return NextResponse.json({ suppliers });
}

export async function POST(request: NextRequest) {
  const auth = await authorize("suppliers", "write");
  if (auth.response) return auth.response;
  const user = auth.user;

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