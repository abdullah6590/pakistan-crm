// src/app/api/sales/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { editSale, SaleError, type SaleInput } from "@/lib/sales/bill";
import { handleApiError } from "@/lib/api-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;

  const { id } = await params;
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { component: { select: { id: true, name: true, sku: true } } } },
      user: { select: { name: true } },
    },
  });

  if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  return NextResponse.json({ sale });
}

/** Edit a saved bill: customer, lines, prices, discount, tax, payment and notes. Stock, the customer's balance
 *  and Finance are corrected with it (src/lib/sales/bill.ts). Fields left out keep their current value. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize("sales", "write");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { id } = await params;
  const existing = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

  const body = await request.json();
  const input: SaleInput = {
    customerId: body.customerId !== undefined ? body.customerId : existing.customerId,
    walkInName: body.walkInName !== undefined ? body.walkInName : existing.walkInName,
    paymentMethod: body.paymentMethod ?? existing.paymentMethod,
    paymentStatus: body.paymentStatus ?? existing.paymentStatus,
    discount: body.discount ?? existing.discount,
    tax: body.tax ?? existing.tax,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    items: Array.isArray(body.items) ? body.items : existing.items.map((i) => ({ componentId: i.componentId, quantity: i.quantity, unitPrice: i.unitPrice })),
  };
  try {
    const sale = await editSale(prisma, user, id, input, body.reason);
    return NextResponse.json({ success: true, sale });
  } catch (error) {
    if (error instanceof SaleError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize("sales", "delete");
  if (auth.response) return auth.response;

  const { id } = await params;
  const existing = await prisma.sale.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

  // Reverse inventory deductions
  const items = await prisma.saleItem.findMany({ where: { saleId: id } });
  for (const item of items) {
    await prisma.component.update({
      where: { id: item.componentId },
      data: {
        quantity: { increment: item.quantity },
        totalSold: { decrement: item.quantity },
      },
    });
  }

  await prisma.sale.delete({ where: { id } });
  return NextResponse.json({ success: true, message: "Sale deleted" });
}
