// src/app/api/reports/customers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import ExcelJS from "exceljs";
import { generateTablePDF } from "@/lib/pdf-generator";
import { buildCustomersWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, CUSTOMERS_SORT_WHITELIST } from "@/lib/sort";

export async function GET(request: NextRequest) {
  const auth = await authorize("reports", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";

  const paramsObj = Object.fromEntries(searchParams.entries());
  const whereClause = buildCustomersWhere(paramsObj);
  const sortConfig = parseSortParams(paramsObj);
  const orderByClause = buildOrderBy(sortConfig, CUSTOMERS_SORT_WHITELIST, { totalPurchased: "desc" });

  const customers = await prisma.customer.findMany({
    where: whereClause,
    orderBy: orderByClause,
    include: { _count: { select: { sales: true } } },
  });

  const totalRevenue = customers.reduce((s, c) => s + c.totalPurchased, 0);
  const avgPerCustomer = customers.length > 0 ? totalRevenue / customers.length : 0;

  if (format === "excel") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Customer Report");
    sheet.columns = [
      { header: "Name", key: "name", width: 25 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Email", key: "email", width: 25 },
      { header: "City", key: "city", width: 15 },
      { header: "Orders", key: "orders", width: 10 },
      { header: "Total Purchased (PKR)", key: "totalPurchased", width: 20 },
      { header: "Status", key: "status", width: 10 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8B5CF6" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    for (const c of customers) {
      sheet.addRow({
        name: c.name,
        phone: c.phone || "—",
        email: c.email || "—",
        city: c.city || "—",
        orders: c._count.sales,
        totalPurchased: c.totalPurchased,
        status: c.isActive ? "Active" : "Inactive",
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=customer-report.xlsx" },
    });
  }

  if (format === "pdf") {
    const buffer = await generateTablePDF(
      "Customer Report",
      ["Name", "Phone", "Email", "City", "Orders", "Total Purchased", "Status"],
      customers.map(c => [
        c.name, c.phone || "—", c.email || "—", c.city || "—",
        String(c._count.sales), String(c.totalPurchased), c.isActive ? "Active" : "Inactive"
      ])
    );
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=customer-report.pdf" },
    });
  }

  return NextResponse.json({
    customers: JSON.parse(JSON.stringify(customers)),
    totalRevenue, avgPerCustomer,
  });
}