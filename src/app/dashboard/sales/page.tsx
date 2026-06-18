// src/app/(dashboard)/sales/page.tsx - Sales List (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SalesClient from "./sales-client";

export default async function SalesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [sales, customers] = await Promise.all([
    prisma.sale.findMany({
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { include: { component: { select: { id: true, name: true, sku: true } } } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalRevenue = sales.reduce((s, sa) => s + sa.total, 0);
  const totalProfit = sales.reduce((s, sa) => s + sa.profit, 0);

  return (
    <SalesClient
      sales={JSON.parse(JSON.stringify(sales))}
      customers={JSON.parse(JSON.stringify(customers))}
      stats={{ totalRevenue, totalProfit, totalSales: sales.length }}
    />
  );
}