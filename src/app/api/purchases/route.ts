// src/app/api/purchases/route.ts - Purchase management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const supplierId = searchParams.get("supplierId");
  const paymentStatus = searchParams.get("paymentStatus");

  const purchases = await prisma.purchase.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { poNumber: { contains: search } },
            { supplier: { name: { contains: search } } },
          ],
        } : {},
        supplierId ? { supplierId } : {},
        paymentStatus ? { paymentStatus: paymentStatus as any } : {},
      ],
    },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      items: { include: { component: { select: { id: true, name: true, sku: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const totals = await prisma.purchase.aggregate({ _sum: { total: true }, _count: true });

  return NextResponse.json({
    purchases,
    stats: { totalSpent: totals._sum.total || 0, totalPurchases: totals._count },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  let subtotal = 0;

  const purchase = await prisma.purchase.create({
    data: {
      poNumber: body.poNumber || `PO-${Date.now()}`,
      supplierId: body.supplierId,
      invoiceRef: body.invoiceRef || null,
      subtotal: 0,
      tax: body.tax || 0,
      shipping: body.shipping || 0,
      total: 0,
      paymentStatus: body.paymentStatus || "PENDING",
      paidAmount: body.paidAmount || 0,
      userId: user.id,
    },
  });

  // Items
  const items = body.items || [];
  for (const item of items) {
    const component = await prisma.component.findUnique({ where: { id: item.componentId } });
    const unitCost = item.unitCost || component?.unitCost || 0;
    const qty = item.quantity;
    const totalCost = unitCost * qty;

    await prisma.purchaseItem.create({
      data: {
        purchaseId: purchase.id,
        componentId: item.componentId,
        quantity: qty,
        unitCost,
        totalCost,
      },
    });

    // Add to inventory
    const updatedComp = await prisma.component.update({
      where: { id: item.componentId },
      data: {
        quantity: { increment: qty },
        unitCost: unitCost, // Update cost to latest purchase
        totalPurchased: { increment: qty },
      },
    });

    await prisma.inventoryHistory.create({
      data: {
        componentId: item.componentId,
        type: "ADD",
        quantity: qty,
        balanceAfter: updatedComp.quantity,
        reference: `Purchase ${purchase.poNumber}`,
        performedBy: user.id,
      },
    });

    subtotal += totalCost;
  }

  const total = subtotal + (body.tax || 0) + (body.shipping || 0);

  const updated = await prisma.purchase.update({
    where: { id: purchase.id },
    data: { subtotal, total },
  });

  // Finance record
  if (body.paymentStatus === "PAID" || (body.paidAmount || 0) > 0) {
    await prisma.finance.create({
      data: {
        transactionRef: `TXN-${Date.now()}`,
        type: "EXPENSE",
        category: "COMPONENT_PURCHASE",
        amount: body.paidAmount || total,
        description: `Purchase ${purchase.poNumber} from ${body.supplierName || "supplier"}`,
        paymentMethod: body.paymentMethod || "BANK_TRANSFER",
        reference: purchase.poNumber,
        referenceId: purchase.id,
        userId: user.id,
      },
    });
  }

  return NextResponse.json({ success: true, purchase: updated }, { status: 201 });
}