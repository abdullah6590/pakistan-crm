// src/app/dashboard/inventory/product/page.tsx - Add New Product, laid out and worked like the old program's screen
// (Report 32 B.4, approved 2026-11-13): the form on the left, the product list on the right.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import ProductDeskClient from "./product-desk-client";

export const dynamic = "force-dynamic";

export default async function ProductDeskPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "inventory", "read")) redirect("/dashboard");
  const sp = await searchParams;
  const groups = await prisma.componentCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, ratePerKg: true } });
  return (
    <ProductDeskClient
      groups={groups}
      canWrite={can(user.role, "inventory", "write")}
      isAdmin={user.role === "ADMIN"}
      startId={sp.id ?? null}
      startNew={sp.new === "1"}
    />
  );
}
