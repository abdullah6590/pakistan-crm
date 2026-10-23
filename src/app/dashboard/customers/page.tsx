// src/app/(dashboard)/customers/page.tsx - Customers (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustomersClient from "./customers-client";
import { buildCustomersWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, CUSTOMERS_SORT_WHITELIST } from "@/lib/sort";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildCustomersWhere(params as any);
  
  const sortConfig = parseSortParams(params as any);
  const orderByClause = buildOrderBy(sortConfig, CUSTOMERS_SORT_WHITELIST, { name: "asc" });

  const [customers, totalCustomers] = await Promise.all([
    prisma.customer.findMany({
      where: whereClause,
      take: limit,
      skip,
      include: { _count: { select: { sales: true } } },
      orderBy: orderByClause,
    }),
    prisma.customer.count({ where: whereClause })
  ]);

  const totalPages = Math.ceil(totalCustomers / limit);

  return (
    <CustomersClient 
      customers={JSON.parse(JSON.stringify(customers))} 
      pagination={{ page, totalPages, totalRecords: totalCustomers }} 
    />
  );
}