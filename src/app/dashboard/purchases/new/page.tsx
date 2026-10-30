// src/app/dashboard/purchases/new/page.tsx - Enter a purchase bill on Books (Report 30).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_ACCOUNTS } from "@/lib/sales/books-sales";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import NewPurchaseClient from "./new-purchase-client";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<{ supplierId?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "purchases", "write")) redirect("/dashboard/purchases");
  const p = await searchParams;
  const [items, suppliers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true }, orderBy: { totalPurchased: "desc" }, take: 15,
      select: { id: true, name: true, sku: true, quantity: true, ...UNIT_FIELDS },
    }),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <NewPurchaseClient
      key={p.supplierId ?? "new"}
      suppliers={suppliers}
      initialItems={JSON.parse(JSON.stringify(items.map(withSaleUnits)))}
      methods={Object.entries(PAYMENT_METHOD_ACCOUNTS).map(([value, m]) => ({ value, label: m.name === "Cash in hand" ? "Cash" : m.name }))}
      canPay={can(user.role, "supplierPayments", "write")}
      initialSupplier={suppliers.find((s) => s.id === p.supplierId) ?? null}
    />
  );
}
