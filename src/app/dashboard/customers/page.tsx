// src/app/(dashboard)/customers/page.tsx - Customers (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustomersClient from "./customers-client";

export default async function CustomersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const customers = await prisma.customer.findMany({
    include: { _count: { select: { sales: true } } },
    orderBy: { createdAt: "desc" },
  });

  return <CustomersClient customers={JSON.parse(JSON.stringify(customers))} />;
}