// src/app/(dashboard)/inventory/page.tsx - Inventory List (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import InventoryClient from "./inventory-client";
import { buildInventoryWhere } from "@/lib/filters";

export default async function InventoryPage({ searchParams }: { searchParams: { page?: string, search?: string, categoryId?: string, supplierId?: string, lowStock?: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildInventoryWhere(params as any);

  const [components, totalComponentsCount, allStats, lowStockCount, categories, suppliers] = await Promise.all([
    prisma.component.findMany({
      where: whereClause,
      include: {
        category: { select: { id: true, name: true, color: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.component.count({ where: whereClause }),
    prisma.component.aggregate({
      _sum: { quantity: true },
      _count: true,
    }),
    prisma.component.count({ where: { quantity: { lte: prisma.component.fields.minQuantity } } }),
    prisma.componentCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
  ]);

  const totalPages = Math.ceil(totalComponentsCount / limit);

  // We can't aggregate totalValue easily with Prisma because it's quantity * unitCost (which is a column multiplication).
  // In a real app we'd use a raw query: `SELECT SUM(quantity * unitCost) FROM components`
  // But for now, we'll fetch just the quantities and costs to calculate the value, 
  // since this is a summary stat (or we can just skip it if it's too slow. Let's do a fast findMany select for just the math).
  
  const allComponentValues = await prisma.component.findMany({
    select: { quantity: true, unitCost: true }
  });
  const totalValue = allComponentValues.reduce((s, c) => s + (c.quantity * c.unitCost), 0);

  return (
    <InventoryClient
      components={JSON.parse(JSON.stringify(components))}
      categories={JSON.parse(JSON.stringify(categories))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      stats={{ 
        totalQuantity: allStats._sum.quantity || 0, 
        totalValue, 
        totalItems: allStats._count, 
        lowStockCount 
      }}
      pagination={{ page, totalPages, totalRecords: totalComponentsCount }}
    />
  );
}