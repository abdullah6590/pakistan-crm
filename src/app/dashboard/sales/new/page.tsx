// src/app/(dashboard)/sales/new/page.tsx - New Sale (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import NewSaleClient from "./new-sale-client";

export default async function NewSalePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [initialComponents, initialCustomers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
      orderBy: { totalSold: "desc" },
      take: 15,
      select: {
        id: true, name: true, sku: true, quantity: true,
        unitCost: true, unitPrice: true, minQuantity: true
      },
    }),
    prisma.customer.findMany({ 
      where: { isActive: true }, 
      select: { id: true, name: true, phone: true }, 
      orderBy: { visitCount: "desc" },
      take: 10,
    }),
  ]);

  return (
    <NewSaleClient
      initialComponents={JSON.parse(JSON.stringify(initialComponents))}
      initialCustomers={JSON.parse(JSON.stringify(initialCustomers))}
    />
  );
}