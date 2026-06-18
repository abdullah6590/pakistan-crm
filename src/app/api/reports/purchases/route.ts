// src/app/api/reports/purchases/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import ExcelJS from "exceljs";

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

  const purchases = await prisma.purchase.findMany({
    where,
    orderBy: { createdAt: "desc" },
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
    return new NextResponse(buffer, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=purchase-report.xlsx" },
    });
  }

  return NextResponse.json({
    purchases: JSON.parse(JSON.stringify(purchases)),
    totalSpent, pendingPayments,
  });
}