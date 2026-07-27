// src/app/api/inventory/route.ts - Inventory management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { componentSchema } from "@/lib/validations";
import { generateSKU } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const categoryId = searchParams.get("categoryId");
  const lowStock = searchParams.get("lowStock") === "true";

  const components = await prisma.component.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } },
          ],
        } : {},
        categoryId ? { categoryId } : {},
        lowStock ? { quantity: { lte: prisma.component.fields.minQuantity } } : {},
      ],
    },
    include: { category: true, supplier: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });

  // Summary stats
  const totalItems = await prisma.component.aggregate({ _sum: { quantity: true } });
  const totalValue = await prisma.component.aggregate({ _sum: { quantity: true } });
  const lowStockCount = await prisma.component.count({ where: { quantity: { lte: prisma.component.fields.minQuantity } } });

  return NextResponse.json({
    components,
    stats: {
      totalItems: totalItems._sum.quantity || 0,
      totalComponents: components.length,
      lowStock: lowStockCount,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = componentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sku = body.sku || generateSKU(body.category || "GEN", Date.now() % 100000);

  const component = await prisma.component.create({
    data: { ...parsed.data, sku },
    include: { category: true, supplier: true },
  });

  // Log inventory history
  await prisma.inventoryHistory.create({
    data: {
      componentId: component.id,
      type: "ADD",
      quantity: component.quantity,
      balanceAfter: component.quantity,
      reference: `Initial stock - ${component.sku}`,
      performedBy: user.id,
    },
  });

  return NextResponse.json({ success: true, component }, { status: 201 });
}