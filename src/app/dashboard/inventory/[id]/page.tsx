// src/app/(dashboard)/inventory/[id]/page.tsx - Inventory Detail (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import InventoryDetailClient from "./inventory-detail-client";

interface Props { params: Promise<{ id: string }> }

export default async function InventoryDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const component = await prisma.component.findUnique({
    where: { id },
    include: {
      category: true,
      supplier: { select: { id: true, name: true } },
      inventoryHistory: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      projectComponents: {
        include: { project: { select: { id: true, name: true, projectId: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!component) notFound();

  const [categories, suppliers] = await Promise.all([
    prisma.componentCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <InventoryDetailClient
      component={JSON.parse(JSON.stringify(component))}
      categories={JSON.parse(JSON.stringify(categories))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
    />
  );
}