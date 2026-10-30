// src/app/dashboard/suppliers/page.tsx - Suppliers (Report 30 §1): search, filter, what each is owed (from Books), add.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady, serialize } from "@/lib/accounting/server";
import { supplierList } from "@/lib/purchases/queries";
import SuppliersClient, { type SupplierRow } from "./suppliers-client";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string; owed?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "suppliers", "read")) redirect("/dashboard");
  await accountingReady();
  const p = await searchParams;
  const status = (["active", "archived", "all"] as const).find((s) => s === p.status) ?? "active";
  const suppliers = await supplierList(prisma, { search: p.search, status, withBalance: p.owed === "1" });
  return <SuppliersClient suppliers={serialize(suppliers) as SupplierRow[]} canEdit={can(user.role, "suppliers", "write")} filters={{ search: p.search ?? "", status, owed: p.owed === "1" }} />;
}
