// src/app/api/cash-sales/route.ts - Cash Sale (Counter Sale) management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { cashSaleSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validation = cashSaleSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 400 });
  }

  const data = validation.data;

  // Generate receipt number
  const count = await prisma.cashSale.count();
  const receiptNo = `CS-${String(count + 1).padStart(4, "0")}`;

  const sale = await prisma.cashSale.create({
    data: {
      receiptNo,
      customerName: data.customerName || null,
      date: data.date || new Date(),
      amount: data.amount,
      remarks: data.remarks || null,
      paymentMethod: (data.paymentMethod as any) || "CASH",
      userId: user.id,
    },
  });

  // Create finance record
  await prisma.finance.create({
    data: {
      transactionRef: `TXN-CS-${Date.now()}`,
      type: "INCOME",
      category: "COMPONENT_SALE",
      amount: data.amount,
      description: `Cash Sale ${receiptNo}${data.customerName ? ` - ${data.customerName}` : ""}`,
      paymentMethod: data.paymentMethod || "CASH",
      reference: receiptNo,
      referenceId: sale.id,
      userId: user.id,
    },
  });

  return NextResponse.json({ success: true, sale }, { status: 201 });
}
