// src/app/(dashboard)/sales/page.tsx - Sales List (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SalesClient from "./sales-client";
import { buildSalesWhere } from "@/lib/filters";

export default async function SalesPage({ searchParams }: { searchParams: { page?: string, search?: string, customerId?: string, paymentStatus?: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildSalesWhere(params as any);

  const [sales, totalSalesCount, allStats, customers] = await Promise.all([
    prisma.sale.findMany({
      where: whereClause,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { include: { component: { select: { id: true, name: true, sku: true } } } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.sale.count({ where: whereClause }),
    prisma.sale.aggregate({
      _sum: { total: true, profit: true },
      _count: true,
    }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.ceil(totalSalesCount / limit);

  return (
    <SalesClient
      sales={JSON.parse(JSON.stringify(sales))}
      customers={JSON.parse(JSON.stringify(customers))}
      stats={{ 
        totalRevenue: allStats._sum.total || 0, 
        totalProfit: allStats._sum.profit || 0, 
        totalSales: allStats._count 
      }}
      pagination={{ page, totalPages, totalRecords: totalSalesCount }}
    />
  );
}