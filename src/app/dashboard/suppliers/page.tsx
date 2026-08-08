// src/app/(dashboard)/suppliers/page.tsx - Suppliers (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SuppliersClient from "./suppliers-client";
import { buildSuppliersWhere } from "@/lib/filters";

export default async function SuppliersPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildSuppliersWhere(params as any);

  const [suppliers, totalSuppliers] = await Promise.all([
    prisma.supplier.findMany({
      where: whereClause,
      take: limit,
      skip,
      include: { _count: { select: { purchases: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplier.count({ where: whereClause })
  ]);

  const totalPages = Math.ceil(totalSuppliers / limit);

  return (
    <SuppliersClient 
      suppliers={JSON.parse(JSON.stringify(suppliers))} 
      pagination={{ page, totalPages, totalRecords: totalSuppliers }} 
    />
  );
}