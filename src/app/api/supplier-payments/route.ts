// src/app/api/supplier-payments/route.ts - Supplier Payment management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await authorize("supplierPayments", "read");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const supplierId = searchParams.get("supplierId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search") || "";

  const payments = await prisma.supplierPayment.findMany({
    where: {
      AND: [
        supplierId ? { supplierId } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
        search ? { supplier: { name: { contains: search } } } : {},
      ],
    },
    include: {
      supplier: { select: { id: true, name: true, company: true, phone: true } },
    },
    orderBy: { date: "desc" },
  });

  const totals = await prisma.supplierPayment.aggregate({
    _sum: { amount: true },
    _count: true,
    ...(supplierId ? { where: { supplierId } } : {}),
  });

  return NextResponse.json({
    payments,
    stats: {
      totalPaid: totals._sum.amount || 0,
      totalPayments: totals._count,
    },
  });
}

/**
 * Supplier payments are made in Books now (Purchases → Pay supplier), linked to the bills they settle (Report 30). This
 * older list stays readable; it no longer records payments, so a payment can never be posted twice through two screens.
 */
export async function POST() {
  const auth = await authorize("supplierPayments", "write");
  if (auth.response) return auth.response;
  return NextResponse.json({ error: "Supplier payments are recorded in Purchases → Pay supplier now; this older list is read-only" }, { status: 409 });
}
