// src/app/dashboard/sales/payments/page.tsx - Receive a customer's payment against their bills (Report 28 §2).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_ACCOUNTS } from "@/lib/sales/books-sales";
import PaymentsClient from "./payments-client";

export const dynamic = "force-dynamic";

export default async function ReceivePaymentPage({ searchParams }: { searchParams: Promise<{ customerId?: string; invoice?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "customerPayments", "write")) redirect("/dashboard/sales");
  const p = await searchParams;
  const [customers, accounts] = await Promise.all([
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    prisma.ledgerAccount.findMany({ where: { kind: "CASH_BANK", isActive: true }, select: { id: true, name: true, subType: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <PaymentsClient
      customers={customers.map((c) => ({ ...c, phone: c.phone ?? "" }))}
      accounts={accounts}
      methods={Object.entries(PAYMENT_METHOD_ACCOUNTS).map(([value, m]) => ({ value, label: m.name === "Cash in hand" ? "Cash" : m.name, subType: m.subType, code: `PM-${value}` }))}
      initialCustomerId={p.customerId ?? null}
      focusInvoiceId={p.invoice ?? null}
      canRefund={can(user.role, "vouchers", "write")}
    />
  );
}
