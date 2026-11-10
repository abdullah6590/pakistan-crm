// src/app/dashboard/inventory/groups/page.tsx - Item groups (the old program's "Item Group"): every product group with
// how many products it holds and their stock, a link to its products, and a form to add a group.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import ItemGroupsClient from "./item-groups-client";

export const dynamic = "force-dynamic";

export default async function ItemGroupsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "inventory", "read")) redirect("/dashboard");

  const [groups, counts] = await Promise.all([
    prisma.componentCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, description: true, color: true } }),
    prisma.component.groupBy({ by: ["categoryId"], where: { isActive: true }, _count: { _all: true } }),
  ]);
  const byGroup = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const rows = groups.map((g) => ({ ...g, products: byGroup.get(g.id) ?? 0 }));

  return <ItemGroupsClient groups={rows} canAdd={can(user.role, "inventory", "write")} />;
}
