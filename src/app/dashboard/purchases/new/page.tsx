// src/app/(dashboard)/purchases/new/page.tsx - New Purchase (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import NewPurchaseClient from "./new-purchase-client";

export default async function NewPurchasePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [initialComponents, initialSuppliers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
      orderBy: { totalSold: "desc" },
      take: 15,
      select: {
        id: true, name: true, sku: true, quantity: true,
        unitCost: true, unitPrice: true, minQuantity: true
      },
    }),
    prisma.supplier.findMany({ 
      where: { isActive: true }, 
      select: { id: true, name: true, phone: true }, 
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <NewPurchaseClient
      initialComponents={JSON.parse(JSON.stringify(initialComponents))}
      initialSuppliers={JSON.parse(JSON.stringify(initialSuppliers))}
    />
  );
}