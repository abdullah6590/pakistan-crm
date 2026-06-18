// src/app/api/sales/route.ts - Sales management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { saleSchema } from "@/lib/validations";
import { generateInvoiceNumber } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const customerId = searchParams.get("customerId");
  const paymentStatus = searchParams.get("paymentStatus");

  const sales = await prisma.sale.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { invoiceNumber: { contains: search, mode: "insensitive" } },
            { walkInName: { contains: search, mode: "insensitive" } },
            { customer: { name: { contains: search, mode: "insensitive" } } },
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
  });

  // Stats
  const totalSales = await prisma.sale.aggregate({
    _sum: { total: true, profit: true },
    _count: true,
  });

  return NextResponse.json({
    sales,
    stats: {
      totalRevenue: totalSales._sum.total || 0,
      totalProfit: totalSales._sum.profit || 0,
      totalSales: totalSales._count,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const invoiceNumber = body.invoiceNumber || generateInvoiceNumber("INV", Date.now() % 10000);

  // Calculate totals
  let subtotal = 0;
  let totalProfit = 0;

  const sale = await prisma.sale.create({
    data: {
      invoiceNumber,
      customerId: body.customerId || null,
      walkInName: body.walkInName || null,
      subtotal: 0,
      discount: body.discount || 0,
      tax: body.tax || 0,
      total: 0,
      profit: 0,
      paymentMethod: body.paymentMethod,
      paymentStatus: body.paymentStatus || "PENDING",
      userId: user.userId,
    },
  });

  // Create sale items and update inventory
  const items = body.items || [];
  for (const item of items) {
    const component = await prisma.component.findUnique({ where: { id: item.componentId } });
    if (!component) continue;

    const unitCost = item.unitCost || component.unitCost;
    const unitPrice = item.unitPrice || component.unitPrice;
    const qty = item.quantity;
    const itemProfit = (unitPrice - unitCost) * qty;

    await prisma.saleItem.create({
      data: {
        saleId: sale.id,
        componentId: item.componentId,
        quantity: qty,
        unitCost,
        unitPrice,
        totalCost: unitCost * qty,
        totalPrice: unitPrice * qty,
        profit: itemProfit,
      },
    });

    // Deduct inventory
    await prisma.component.update({
      where: { id: item.componentId },
      data: { quantity: { decrement: qty }, totalSold: { increment: qty } },
    });

    await prisma.inventoryHistory.create({
      data: {
        componentId: item.componentId,
        type: "REMOVE",
        quantity: qty,
        reference: `Sale ${invoiceNumber}`,
        userId: user.userId,
      },
    });

    subtotal += unitPrice * qty;
    totalProfit += itemProfit;
  }

  const total = subtotal - (body.discount || 0) + (body.tax || 0);

  const updated = await prisma.sale.update({
    where: { id: sale.id },
    data: { subtotal, total, profit: totalProfit },
  });

  // Create finance record
  if (body.paymentStatus === "PAID") {
    await prisma.finance.create({
      data: {
        transactionRef: `TXN-${Date.now()}`,
        type: "INCOME",
        category: "COMPONENT_SALE",
        amount: total,
        description: `Sale ${invoiceNumber}`,
        paymentMethod: body.paymentMethod,
        reference: invoiceNumber,
        referenceId: sale.id,
        userId: user.userId,
      },
    });
  }

  return NextResponse.json({ success: true, sale: updated }, { status: 201 });
}