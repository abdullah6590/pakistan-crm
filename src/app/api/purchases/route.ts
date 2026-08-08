// src/app/api/purchases/route.ts - Purchase management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const supplierId = searchParams.get("supplierId");
  const paymentStatus = searchParams.get("paymentStatus");
  let page = parseInt(searchParams.get("page") || "1", 10);
  let limit = parseInt(searchParams.get("limit") || "50", 10);
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 100) limit = 100;

  const skip = (page - 1) * limit;

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
    skip,
    take: limit,
  });

  const totalRecords = await prisma.purchase.count({
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
  });

  const totals = await prisma.purchase.aggregate({ _sum: { total: true }, _count: true });

  return NextResponse.json({
    purchases,
    pagination: {
      total: totalRecords,
      pages: Math.ceil(totalRecords / limit),
      page,
      limit,
    },
    stats: { totalSpent: totals._sum.total || 0, totalPurchases: totals._count },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  try {
    const result = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      // 1. Create base purchase
      const purchase = await tx.purchase.create({
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

      // 2. Process items
      const items = body.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Purchase must contain at least one item");
      }

      for (const item of items) {
        const qty = parseInt(item.quantity, 10);
        if (isNaN(qty) || qty <= 0) throw new Error("Item quantity must be a positive integer");
        
        const unitCost = parseFloat(item.unitCost);
        if (isNaN(unitCost) || !isFinite(unitCost) || unitCost < 0) throw new Error("Invalid unit cost");
        const component = await tx.component.findUnique({ where: { id: item.componentId } });
        if (!component) throw new Error(`Product ${item.componentId} not found`);

        const totalCost = unitCost * qty;

        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            componentId: item.componentId,
            quantity: qty,
            unitCost,
            totalCost,
          },
        });

        // Add to inventory
        const updatedComp = await tx.component.update({
          where: { id: item.componentId },
          data: {
            quantity: { increment: qty },
            unitCost: unitCost, // Update cost to latest purchase
            totalPurchased: { increment: qty },
          },
        });

        await tx.inventoryHistory.create({
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

      // 3. Final calculations
      const tax = parseFloat(body.tax) || 0;
      const shipping = parseFloat(body.shipping) || 0;
      const paidAmount = parseFloat(body.paidAmount) || 0;
      
      if (isNaN(tax) || !isFinite(tax) || tax < 0) throw new Error("Invalid tax amount");
      if (isNaN(shipping) || !isFinite(shipping) || shipping < 0) throw new Error("Invalid shipping amount");
      if (isNaN(paidAmount) || !isFinite(paidAmount) || paidAmount < 0) throw new Error("Invalid paid amount");

      const total = subtotal + tax + shipping;

      const finalPurchase = await tx.purchase.update({
        where: { id: purchase.id },
        data: { subtotal, total },
      });

      // 4. Ledger updates
      if (body.supplierId) {
        const amountPaid = parseFloat(body.paidAmount) || 0;
        
        // Add full total to balanceDue, then subtract what was paid
        if (total > 0) {
          await tx.supplier.update({
            where: { id: body.supplierId },
            data: { balanceDue: { increment: total } },
          });
        }
        
        if (amountPaid > 0) {
          await tx.supplier.update({
            where: { id: body.supplierId },
            data: { balanceDue: { decrement: amountPaid } },
          });
          
          await tx.supplierPayment.create({
            data: {
              supplierId: body.supplierId,
              amount: amountPaid,
              paymentMethod: body.paymentMethod || "CASH",
              notes: `Payment for ${purchase.poNumber}`,
              purchaseId: finalPurchase.id,
              userId: user.id,
            },
          });
        }
      }

      // 5. Finance record
      const amountPaid = parseFloat(body.paidAmount) || 0;
      if (amountPaid > 0 || body.paymentStatus === "PAID") {
        await tx.finance.create({
          data: {
            transactionRef: `TXN-${Date.now()}`,
            type: "EXPENSE",
            category: "COMPONENT_PURCHASE",
            amount: amountPaid > 0 ? amountPaid : total,
            description: `Purchase ${purchase.poNumber} from ${body.supplierName || "supplier"}`,
            paymentMethod: body.paymentMethod || "BANK_TRANSFER",
            reference: purchase.poNumber,
            referenceId: finalPurchase.id,
            userId: user.id,
          },
        });
      }

      return finalPurchase;
    });

    return NextResponse.json({ success: true, purchase: result }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}