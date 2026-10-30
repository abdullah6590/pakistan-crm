// src/app/api/customer-payments/route.ts - Customer Payment management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await authorize("customerPayments", "read");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const search = searchParams.get("search") || "";

  const payments = await prisma.customerPayment.findMany({
    where: {
      AND: [
        customerId ? { customerId } : {},
        startDate ? { date: { gte: new Date(startDate) } } : {},
        endDate ? { date: { lte: new Date(endDate) } } : {},
        search ? { customer: { name: { contains: search } } } : {},
      ],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { date: "desc" },
  });

  const totals = await prisma.customerPayment.aggregate({
    _sum: { amount: true },
    _count: true,
    ...(customerId ? { where: { customerId } } : {}),
  });

  return NextResponse.json({
    payments,
    stats: {
      totalReceived: totals._sum.amount || 0,
      totalPayments: totals._count,
    },
  });
}

/**
 * Customer payments are received in Books now (Sales → Receive payment), linked to the bills they pay (Report 28). This
 * older list stays readable; it no longer records payments, so a payment can never be counted twice.
 */
export async function POST() {
  const auth = await authorize("customerPayments", "write");
  if (auth.response) return auth.response;
  return NextResponse.json({ error: "Customer payments are recorded in Sales → Receive payment now; this older list is read-only" }, { status: 409 });
}
