// src/app/api/sales/route.ts - Sales management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { saleSchema } from "@/lib/validations";
import { generateInvoiceNumber } from "@/lib/utils";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const invoiceNumber = body.invoiceNumber || generateInvoiceNumber("INV", Date.now() % 10000);

  // Calculate totals
  let subtotal = 0;
  let totalProfit = 0;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create base sale
      const sale = await tx.sale.create({
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
          userId: user.id,
        },
      });

      // 2. Process items
      const items = body.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Sale must contain at least one item");
      }

      for (const item of items) {
        const qty = parseInt(item.quantity, 10);
        if (isNaN(qty) || qty <= 0) throw new Error("Item quantity must be a positive integer");
        
        const unitPrice = parseFloat(item.unitPrice);
        if (isNaN(unitPrice) || !isFinite(unitPrice) || unitPrice < 0) throw new Error("Invalid unit price");
        const component = await tx.component.findUnique({ where: { id: item.componentId } });
        if (!component) throw new Error(`Product ${item.componentId} not found`);
        if (!component.isActive) throw new Error(`Product ${component.name} is inactive`);
        if (component.quantity < item.quantity) throw new Error(`Insufficient stock for ${component.name}`);

        const unitCost = component.unitCost; // Authoritative from DB
        const itemProfit = (unitPrice - unitCost) * qty;

        await tx.saleItem.create({
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

        // Atomic Deduct inventory: ensures race conditions cannot drive stock < 0
        const { count } = await tx.component.updateMany({
          where: { 
            id: item.componentId,
            quantity: { gte: qty }
          },
          data: { quantity: { decrement: qty }, totalSold: { increment: qty } },
        });

        if (count === 0) {
          throw new Error(`Insufficient stock for ${component.name}`);
        }
        
        // We still need the updated component to record the balance in history
        const updatedComp = await tx.component.findUnique({ where: { id: item.componentId } });
        if (!updatedComp) throw new Error("Component disappeared during transaction");

        await tx.inventoryHistory.create({
          data: {
            componentId: item.componentId,
            type: "REMOVE",
            quantity: qty,
            balanceAfter: updatedComp.quantity,
            reference: `Sale ${invoiceNumber}`,
            performedBy: user.id,
          },
        });

        subtotal += unitPrice * qty;
        totalProfit += itemProfit;
      }

      // 3. Final calculations
      const discount = parseFloat(body.discount) || 0;
      const tax = parseFloat(body.tax) || 0;
      
      if (isNaN(discount) || !isFinite(discount) || discount < 0) throw new Error("Invalid discount amount");
      if (isNaN(tax) || !isFinite(tax) || tax < 0) throw new Error("Invalid tax amount");
      const total = subtotal - discount + tax;

      const finalSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          subtotal,
          total,
          profit: totalProfit,
        },
      });

      // 4. Ledger updates
      if (body.customerId) {
        if (finalSale.paymentStatus === "PENDING" || finalSale.paymentStatus === "PARTIAL") {
          const balanceToAdd = total;
          await tx.customer.update({
            where: { id: body.customerId },
            data: { 
              balanceDue: { increment: balanceToAdd },
              visitCount: { increment: 1 }
            },
          });
          await tx.customerPayment.create({
            data: {
              customerId: body.customerId,
              amount: balanceToAdd,
              notes: `Charge for Sale ${invoiceNumber}`,
              userId: user.id,
            },
          });
        } else {
          await tx.customer.update({
            where: { id: body.customerId },
            data: { visitCount: { increment: 1 } },
          });
        }
      }

      // 5. Finance
      if (finalSale.paymentStatus === "PAID" || finalSale.paymentStatus === "PARTIAL") {
        await tx.finance.create({
          data: {
            transactionRef: `TXN-SALE-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            type: "INCOME",
            category: "SALES",
            amount: total,
            description: `Sale ${invoiceNumber}`,
            referenceId: finalSale.id,
            paymentMethod: finalSale.paymentMethod,
            userId: user.id,
          },
        });
      }

      return finalSale;
    });

    return NextResponse.json({ sale: result }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}