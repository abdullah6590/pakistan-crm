// src/app/api/customers/route.ts - Customer management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await authorize("customers", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

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
  const auth = await authorize("customers", "write");
  if (auth.response) return auth.response;
  const user = auth.user;

  const body = await request.json();
  const customer = await prisma.customer.create({
    data: {
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      city: body.city || null,
      address: body.address || null,
      notes: body.notes || null,
    },
  });

  return NextResponse.json({ success: true, customer }, { status: 201 });
}