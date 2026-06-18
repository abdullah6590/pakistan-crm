// src/app/(dashboard)/sales/new/page.tsx - New Sale (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import NewSaleClient from "./new-sale-client";

export default async function NewSalePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [components, customers] = await Promise.all([
    prisma.component.findMany({
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <NewSaleClient
      components={JSON.parse(JSON.stringify(components))}
      customers={JSON.parse(JSON.stringify(customers))}
    />
  );
}