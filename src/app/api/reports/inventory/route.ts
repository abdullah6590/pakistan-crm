// src/app/api/reports/inventory/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateInventoryReport } from "@/lib/excel-generator";
import { generateTablePDF } from "@/lib/pdf-generator";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";

  const components = await prisma.component.findMany({
    include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { quantity: "asc" },
  });

  const totalValue = components.reduce((s, c) => s + c.quantity * c.unitCost, 0);
  const lowStockCount = components.filter(c => c.quantity <= c.minQuantity).length;

  if (format === "excel") {
    const buffer = await generateInventoryReport(components.map(c => ({
      sku: c.sku,
      name: c.name,
      category: c.category.name,
      quantity: c.quantity,
      unitCost: c.unitCost,
      unitPrice: c.unitPrice,
      totalValue: c.quantity * c.unitCost,
      minQuantity: c.minQuantity,
      location: c.location || "",
    })));
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=inventory-report.xlsx" },
    });
  }

  if (format === "pdf") {
    const buffer = await generateTablePDF(
      "Inventory Report",
      ["SKU", "Product", "Category", "Quantity", "Total Value", "Status"],
      components.map(c => [
        c.sku, c.name, c.category.name, String(c.quantity), String(c.quantity * c.unitCost), c.quantity <= c.minQuantity ? "Low Stock" : "In Stock"
      ])
    );
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=inventory-report.pdf" },
    });
  }

  return NextResponse.json({
    components: JSON.parse(JSON.stringify(components)),
    totalValue, lowStockCount,
  });
}