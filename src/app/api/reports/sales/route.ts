// src/app/api/reports/sales/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateSalesReport } from "@/lib/excel-generator";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format") || "json";

  const where: any = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59.999Z");
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true } }, items: true },
  });

  const totalRevenue = sales.reduce((s, sale) => s + sale.total, 0);
  const totalProfit = sales.reduce((s, sale) => s + sale.profit, 0);

  if (format === "excel") {
    const buffer = await generateSalesReport(sales.map(s => ({
      invoiceNumber: s.invoiceNumber,
      customer: s.customer?.name || s.walkInName || "Walk-in",
      date: s.createdAt.toISOString().slice(0, 10),
      items: s.items.length,
      total: s.total,
      profit: s.profit,
      status: s.paymentStatus,
    })));
    return new NextResponse(buffer, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=sales-report.xlsx" },
    });
  }

  return NextResponse.json({ sales: JSON.parse(JSON.stringify(sales)), totalRevenue, totalProfit });
}