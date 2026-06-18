// src/app/(dashboard)/purchases/new/page.tsx - New Purchase (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import NewPurchaseClient from "./new-purchase-client";

export default async function NewPurchasePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [components, suppliers] = await Promise.all([
    prisma.component.findMany({
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <NewPurchaseClient
      components={JSON.parse(JSON.stringify(components))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
    />
  );
}