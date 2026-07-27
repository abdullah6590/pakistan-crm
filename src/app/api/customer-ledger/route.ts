// src/app/api/customer-ledger/route.ts - Customer Ledger API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const dateFilter: any = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true, totalPurchased: true, balanceDue: true },
  });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const sales = await prisma.sale.findMany({
    where: { customerId, ...(hasDateFilter ? { createdAt: dateFilter } : {}) },
    include: { items: { include: { component: { select: { name: true, sku: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  const payments = await prisma.customerPayment.findMany({
    where: { customerId, ...(hasDateFilter ? { date: dateFilter } : {}) },
    orderBy: { date: "asc" },
  });

  const entries = [
    ...sales.map(s => ({
      id: s.id, date: s.createdAt, type: "SALE" as const,
      description: `Sale ${s.invoiceNumber}`,
      debit: s.total, credit: 0, reference: s.invoiceNumber,
      details: s.items.map(i => `${i.component.name} x${i.quantity} @ ${i.unitPrice}`).join(", "),
    })),
    ...payments.map(p => ({
      id: p.id, date: p.date, type: "RECEIPT" as const,
      description: `Payment received via ${p.paymentMethod}${p.chequeNumber ? ` (Cheque: ${p.chequeNumber})` : ""}`,
      debit: 0, credit: p.amount, reference: p.chequeNumber || null,
      details: p.notes || "",
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let balance = 0;
  const ledger = entries.map(entry => {
    balance += entry.debit - entry.credit;
    return { ...entry, balance };
  });

  const totalSales = sales.reduce((s, sale) => s + sale.total, 0);
  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);

  return NextResponse.json({
    customer,
    ledger,
    summary: { totalSales, totalReceived, balanceDue: totalSales - totalReceived },
  });
}
