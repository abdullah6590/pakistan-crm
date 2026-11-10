// src/app/api/cash-sales/route.ts - The old Cash Sales screen's records (read-only since 2026-11-10). It saved to the old
// cash-sale and Finance tables, outside Books: no stock movement, not in the ledgers, daybook or Profit & Loss. Cash
// sales are now entered on New sale with the walk-in customer, so new entries here are refused.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await authorize("cashSales", "read");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const todayOnly = searchParams.get("todayOnly") === "true";

  let dateFilter = {};
  if (todayOnly) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateFilter = { date: { gte: today, lt: tomorrow } };
  } else {
    if (startDate) dateFilter = { ...dateFilter, date: { gte: new Date(startDate) } };
    if (endDate) dateFilter = { ...dateFilter, date: { ...((dateFilter as any).date || {}), lte: new Date(endDate) } };
  }

  const sales = await prisma.cashSale.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { customerName: { contains: search } },
            { receiptNo: { contains: search } },
            { remarks: { contains: search } },
          ],
        } : {},
        dateFilter,
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const totals = await prisma.cashSale.aggregate({
    _sum: { amount: true },
    _count: true,
    where: todayOnly ? dateFilter : undefined,
  });

  return NextResponse.json({
    sales,
    stats: {
      totalAmount: totals._sum.amount || 0,
      totalSales: totals._count,
    },
  });
}

const OLD_CASH_SALES_CLOSED =
  "Cash sales are now entered on New sale with the walk-in customer, so they count in stock, the ledgers and Profit & Loss. The old Cash Sales screen is read-only.";

export async function POST() {
  const auth = await authorize("cashSales", "write");
  if (auth.response) return auth.response;
  return NextResponse.json({ error: OLD_CASH_SALES_CLOSED }, { status: 409 });
}
