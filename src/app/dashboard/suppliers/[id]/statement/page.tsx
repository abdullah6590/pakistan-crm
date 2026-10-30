// src/app/dashboard/suppliers/[id]/statement/page.tsx - A supplier's statement from Books (Report 30 §7): opening balance,
// bills, payments, returns, refunds and adjustments with a running balance, and the closing balance.
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { serialize } from "@/lib/accounting/server";
import { supplierStatement } from "@/lib/purchases/queries";
import StatementClient, { type SupplierStatement } from "./statement-client";

export const dynamic = "force-dynamic";

export default async function SupplierStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "suppliers", "read")) redirect("/dashboard");
  const { id } = await params;
  const p = await searchParams;
  const st = await supplierStatement(prisma, id, { from: p.from, to: p.to });
  if (!st) notFound();
  return <StatementClient statement={serialize(st) as SupplierStatement} />;
}
