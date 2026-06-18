// src/app/(dashboard)/inventory/page.tsx - Inventory List (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import InventoryClient from "./inventory-client";

export default async function InventoryPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [components, categories, suppliers] = await Promise.all([
    prisma.component.findMany({
      include: {
        category: { select: { id: true, name: true, color: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.componentCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Stats
  const totalQuantity = components.reduce((s, c) => s + c.quantity, 0);
  const totalValue = components.reduce((s, c) => s + c.quantity * c.unitCost, 0);
  const lowStockCount = components.filter((c) => c.quantity <= c.minQuantity).length;

  return (
    <InventoryClient
      components={JSON.parse(JSON.stringify(components))}
      categories={JSON.parse(JSON.stringify(categories))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      stats={{ totalQuantity, totalValue, totalItems: components.length, lowStockCount }}
    />
  );
}