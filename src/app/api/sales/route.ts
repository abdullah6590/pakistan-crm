// src/app/api/sales/route.ts - Sales management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { saleSchema } from "@/lib/validations";
import { generateInvoiceNumber } from "@/lib/utils";
import { handleApiError } from "@/lib/api-error";
import { createSale, SaleError } from "@/lib/sales/bill";

export async function GET(request: NextRequest) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const customerId = searchParams.get("customerId");
  const paymentStatus = searchParams.get("paymentStatus");
  let page = parseInt(searchParams.get("page") || "1", 10);
  let limit = parseInt(searchParams.get("limit") || "50", 10);
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 100) limit = 100;

  const skip = (page - 1) * limit;

  const sales = await prisma.sale.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { invoiceNumber: { contains: search } },
            { walkInName: { contains: search } },
            { customer: { name: { contains: search } } },
          ],
        } : {},
        customerId ? { customerId } : {},
        paymentStatus ? { paymentStatus: paymentStatus as any } : {},
      ],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { component: { select: { id: true, name: true, sku: true } } } },
    },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const totalRecords = await prisma.sale.count({
    where: {
      AND: [
        search ? {
          OR: [
            { invoiceNumber: { contains: search } },
            { walkInName: { contains: search } },
            { customer: { name: { contains: search } } },
          ],
        } : {},
        customerId ? { customerId } : {},
        paymentStatus ? { paymentStatus: paymentStatus as any } : {},
      ],
    },
  });

  // Stats
  const totalSales = await prisma.sale.aggregate({
    _sum: { total: true, profit: true },
    _count: true,
  });

  return NextResponse.json({
    sales,
    pagination: {
      total: totalRecords,
      pages: Math.ceil(totalRecords / limit),
      page,
      limit,
    },
    stats: {
      totalRevenue: totalSales._sum.total || 0,
      totalProfit: totalSales._sum.profit || 0,
      totalSales: totalSales._count,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize("sales", "write");
  if (auth.response) return auth.response;
  const user = auth.user;

  const body = await request.json();
  const invoiceNumber = body.invoiceNumber || generateInvoiceNumber("INV", Date.now() % 10000);

  try {
    // Stock, the customer's charge and Finance are applied with the bill (src/lib/sales/bill.ts)
    const result = await prisma.$transaction((tx) => createSale(tx, user.id, body, invoiceNumber));

    return NextResponse.json({ sale: result }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SaleError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return handleApiError(error);
  }
}