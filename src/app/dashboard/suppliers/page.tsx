// src/app/(dashboard)/suppliers/page.tsx - Suppliers (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SuppliersClient from "./suppliers-client";

export default async function SuppliersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const suppliers = await prisma.supplier.findMany({
    include: { _count: { select: { purchases: true } } },
    orderBy: { createdAt: "desc" },
  });

  return <SuppliersClient suppliers={JSON.parse(JSON.stringify(suppliers))} />;
}