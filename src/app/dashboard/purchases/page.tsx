// src/app/(dashboard)/purchases/page.tsx - Purchases List (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import PurchasesClient from "./purchases-client";

export default async function PurchasesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [purchases, suppliers] = await Promise.all([
    prisma.purchase.findMany({
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        items: { include: { component: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalSpent = purchases.reduce((s, p) => s + p.total, 0);
  const totalPaid = purchases.reduce((s, p) => s + p.paidAmount, 0);
  const totalPending = purchases
    .filter(p => p.paymentStatus === "PENDING" || p.paymentStatus === "PARTIAL")
    .reduce((s, p) => s + (p.total - p.paidAmount), 0);

  return (
    <PurchasesClient
      purchases={JSON.parse(JSON.stringify(purchases))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      stats={{ totalSpent, totalPaid, totalPending, totalPurchases: purchases.length }}
    />
  );
}