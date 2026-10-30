// src/app/api/reports/sales/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateSalesReport } from "@/lib/excel-generator";
import { generateTablePDF } from "@/lib/pdf-generator";
import { buildSalesWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, SALES_SORT_WHITELIST } from "@/lib/sort";
import { listBills } from "@/lib/sales/books-queries";

const STATUS: Record<string, string> = { PAID: "PAID", PARTIALLY_PAID: "PARTIAL", UNPAID: "PENDING" };

export async function GET(request: NextRequest) {
  const auth = await authorize("reports", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format") || "json";

  const paramsObj = Object.fromEntries(searchParams.entries());
  const whereClause = buildSalesWhere(paramsObj);
  const sortConfig = parseSortParams(paramsObj);
  const orderByClause = buildOrderBy(sortConfig, SALES_SORT_WHITELIST, { createdAt: "desc" });

  const olderSales = await prisma.sale.findMany({
    where: whereClause,
    orderBy: orderByClause,
    include: { customer: { select: { name: true } }, items: true },
  });
  // Bills since Sales moved to Books (Report 28), in the same shape as the older bills
  const books = await listBills(prisma, { from: from ?? undefined, to: to ?? undefined, search: searchParams.get("search") ?? undefined, customerId: searchParams.get("customerId") ?? undefined }, 100_000);
  const sales = [
    ...books.rows.map((r) => ({
      id: r.id, invoiceNumber: r.docNo, customer: r.walkIn ? null : { name: r.customer }, walkInName: r.walkIn ? r.customer : null,
      createdAt: new Date(r.date), items: r.items ? r.items.split(", ").map((name) => ({ name })) : [],
      total: Number(r.total), profit: Number(r.profit), paymentStatus: STATUS[r.paymentStatus] ?? r.paymentStatus,
    })),
    ...olderSales,
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

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
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=sales-report.xlsx" },
    });
  }

  if (format === "pdf") {
    const buffer = await generateTablePDF(
      "Sales Report",
      ["Invoice", "Customer", "Date", "Items", "Total", "Profit", "Status"],
      sales.map(s => [
        s.invoiceNumber, s.customer?.name || s.walkInName || "Walk-in", s.createdAt.toISOString().slice(0, 10), String(s.items.length), String(s.total), String(s.profit), s.paymentStatus
      ])
    );
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=sales-report.pdf" },
    });
  }

  return NextResponse.json({ sales: JSON.parse(JSON.stringify(sales)), totalRevenue, totalProfit });
}