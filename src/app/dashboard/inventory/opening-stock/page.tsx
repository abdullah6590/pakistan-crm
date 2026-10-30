// src/app/dashboard/inventory/opening-stock/page.tsx - Enter stock already on hand into Books, once per item, at a cost
// the owner confirms (owner instruction 2026-10-26).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady } from "@/lib/accounting/server";
import { openingStockCandidates } from "@/lib/accounting/opening-stock";
import OpeningStockClient from "./opening-stock-client";

export const dynamic = "force-dynamic";

export default async function OpeningStockPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "inventory", "read")) redirect("/dashboard");
  await accountingReady();
  const items = await openingStockCandidates(prisma);
  return <OpeningStockClient items={items} canPost={user.role === "ADMIN"} canEditUnits={can(user.role, "inventory", "write")} />;
}
