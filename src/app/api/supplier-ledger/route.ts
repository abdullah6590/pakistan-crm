// src/app/api/supplier-ledger/route.ts - Supplier Ledger API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const supplierId = searchParams.get("supplierId");
  if (!supplierId) return NextResponse.json({ error: "supplierId is required" }, { status: 400 });

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const dateFilter: any = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, company: true, phone: true, totalPurchased: true, balanceDue: true },
  });
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  const purchases = await prisma.purchase.findMany({
    where: { supplierId, ...(hasDateFilter ? { createdAt: dateFilter } : {}) },
    include: { items: { include: { component: { select: { name: true, sku: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  const payments = await prisma.supplierPayment.findMany({
    where: { supplierId, ...(hasDateFilter ? { date: dateFilter } : {}) },
    orderBy: { date: "asc" },
  });

  // Build chronological ledger
  const entries = [
    ...purchases.map(p => ({
      id: p.id, date: p.createdAt, type: "PURCHASE" as const,
      description: `Purchase ${p.poNumber}${p.invoiceRef ? ` (Ref: ${p.invoiceRef})` : ""}`,
      debit: p.total, credit: 0, reference: p.poNumber,
      details: p.items.map(i => `${i.component.name} x${i.quantity} @ ${i.unitCost}`).join(", "),
    })),
    ...payments.map(p => ({
      id: p.id, date: p.date, type: "PAYMENT" as const,
      description: `Payment via ${p.paymentMethod}${p.chequeNumber ? ` (Cheque: ${p.chequeNumber})` : ""}`,
      debit: 0, credit: p.amount, reference: p.chequeNumber || null,
      details: p.notes || "",
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Calculate running balance
  let balance = 0;
  const ledger = entries.map(entry => {
    balance += entry.debit - entry.credit;
    return { ...entry, balance };
  });

  const totalPurchased = purchases.reduce((s, p) => s + p.total, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  return NextResponse.json({
    supplier,
    ledger,
    summary: { totalPurchased, totalPaid, balanceDue: totalPurchased - totalPaid },
  });
}
