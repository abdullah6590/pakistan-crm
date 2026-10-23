// src/app/api/reports/purchases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import ExcelJS from "exceljs";
import { generateTablePDF } from "@/lib/pdf-generator";
import { buildPurchasesWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, PURCHASES_SORT_WHITELIST } from "@/lib/sort";

export async function GET(request: NextRequest) {
  const auth = await authorize("reports", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format") || "json";

  const paramsObj = Object.fromEntries(searchParams.entries());
  const whereClause = buildPurchasesWhere(paramsObj);
  const sortConfig = parseSortParams(paramsObj);
  const orderByClause = buildOrderBy(sortConfig, PURCHASES_SORT_WHITELIST, { createdAt: "desc" });

  const purchases = await prisma.purchase.findMany({
    where: whereClause,
    orderBy: orderByClause,
    include: { supplier: { select: { name: true } }, items: true },
  });

  const totalSpent = purchases.reduce((s, p) => s + p.total, 0);
  const pendingPayments = purchases
    .filter(p => p.paymentStatus === "PENDING" || p.paymentStatus === "PARTIAL")
    .reduce((s, p) => s + (p.total - p.paidAmount), 0);

  if (format === "excel") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Purchase Report");
    sheet.columns = [
      { header: "PO Number", key: "poNumber", width: 14 },
      { header: "Supplier", key: "supplier", width: 25 },
      { header: "Date", key: "date", width: 14 },
      { header: "Items", key: "items", width: 8 },
      { header: "Total (PKR)", key: "total", width: 16 },
      { header: "Paid (PKR)", key: "paid", width: 16 },
      { header: "Status", key: "status", width: 12 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF59E0B" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    for (const p of purchases) {
      sheet.addRow({
        poNumber: p.poNumber,
        supplier: p.supplier?.name || "—",
        date: p.createdAt.toISOString().slice(0, 10),
        items: p.items.length,
        total: p.total,
        paid: p.paidAmount,
        status: p.paymentStatus,
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=purchase-report.xlsx" },
    });
  }

  if (format === "pdf") {
    const buffer = await generateTablePDF(
      "Purchase Report",
      ["PO Number", "Supplier", "Date", "Items", "Total", "Paid", "Status"],
      purchases.map(p => [
        p.poNumber, p.supplier?.name || "—", p.createdAt.toISOString().slice(0, 10), String(p.items.length), String(p.total), String(p.paidAmount), p.paymentStatus
      ])
    );
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=purchase-report.pdf" },
    });
  }

  return NextResponse.json({
    purchases: JSON.parse(JSON.stringify(purchases)),
    totalSpent, pendingPayments,
  });
}