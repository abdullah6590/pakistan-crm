// src/app/dashboard/suppliers/page.tsx - Suppliers (Report 30 §1): search, filter, what each is owed (from Books), add.
import { catalogReady } from "@/lib/accounting/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady, serialize } from "@/lib/accounting/server";
import { supplierList } from "@/lib/purchases/queries";
import { partyMoney, partyMoneyTotals } from "@/lib/accounting/books-reports";
import SuppliersClient, { type SupplierRow } from "./suppliers-client";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string; owed?: string }> }) {
  const user = await getAuthUser();
  await catalogReady(); // product and party numbers (Report 32 phase 1)
  if (!user) redirect("/login");
  if (!can(user.role, "suppliers", "read")) redirect("/dashboard");
  await accountingReady();
  const p = await searchParams;
  const status = (["active", "archived", "all"] as const).find((s) => s === p.status) ?? "active";
  const list = await supplierList(prisma, { search: p.search, status, withBalance: p.owed === "1" });
  // Billed, paid and balance of each supplier and of all suppliers together, from Books
  const money = await partyMoney(prisma, list.flatMap((x) => (x.partyAccountId ? [x.partyAccountId] : [])), "SUPPLIER");
  const suppliers = list.map((x) => ({ ...x, money: x.partyAccountId ? money.get(x.partyAccountId) ?? null : null }));
  const totals = await partyMoneyTotals(prisma, "SUPPLIER");
  return <SuppliersClient suppliers={serialize(suppliers) as SupplierRow[]} totals={totals} canEdit={can(user.role, "suppliers", "write")} filters={{ search: p.search ?? "", status, owed: p.owed === "1" }} />;
}
