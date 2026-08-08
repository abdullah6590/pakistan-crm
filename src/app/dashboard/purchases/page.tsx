// src/app/(dashboard)/purchases/page.tsx - Purchases List (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import PurchasesClient from "./purchases-client";
import { buildPurchasesWhere } from "@/lib/filters";

export default async function PurchasesPage({ searchParams }: { searchParams: { page?: string, search?: string, supplierId?: string, paymentStatus?: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildPurchasesWhere(params as any);

  const [purchases, totalPurchasesCount, allStats, suppliers] = await Promise.all([
    prisma.purchase.findMany({
      where: whereClause,
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        items: { include: { component: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.purchase.count({ where: whereClause }),
    prisma.purchase.aggregate({
      _sum: { total: true, paidAmount: true },
      _count: true,
    }),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 100 }),
  ]);

  const totalPages = Math.ceil(totalPurchasesCount / limit);
  const totalPending = (allStats._sum.total || 0) - (allStats._sum.paidAmount || 0);

  return (
    <PurchasesClient
      purchases={JSON.parse(JSON.stringify(purchases))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      stats={{ 
        totalSpent: allStats._sum.total || 0, 
        totalPaid: allStats._sum.paidAmount || 0, 
        totalPending, 
        totalPurchases: allStats._count 
      }}
      pagination={{ page, totalPages, totalRecords: totalPurchasesCount }}
    />
  );
}