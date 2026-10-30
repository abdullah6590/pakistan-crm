// src/app/dashboard/purchases/pay/page.tsx - Pay a supplier against their bills (Report 30 §3). Opened from the menu
// (choose the supplier) or from a purchase bill (`?supplierId=&bill=`: supplier and bill already chosen).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_ACCOUNTS } from "@/lib/sales/books-sales";
import PaySupplierClient from "./pay-client";

export const dynamic = "force-dynamic";

export default async function PaySupplierPage({ searchParams }: { searchParams: Promise<{ supplierId?: string; bill?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "supplierPayments", "write")) redirect("/dashboard/purchases");
  const p = await searchParams;
  const [suppliers, accounts] = await Promise.all([
    prisma.supplier.findMany({ select: { id: true, name: true, phone: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.ledgerAccount.findMany({ where: { kind: "CASH_BANK", isActive: true }, select: { id: true, name: true, subType: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <PaySupplierClient
      suppliers={suppliers.map((s) => ({ ...s, phone: s.phone ?? "" }))}
      accounts={accounts}
      methods={Object.entries(PAYMENT_METHOD_ACCOUNTS).map(([value, m]) => ({ value, label: m.name === "Cash in hand" ? "Cash" : m.name, subType: m.subType }))}
      initialSupplierId={p.supplierId ?? null}
      focusBillId={p.bill ?? null}
    />
  );
}
