// src/app/(dashboard)/projects/new/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { NewProjectClient } from "./new-project-client";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [users, components] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true } }),
    prisma.component.findMany({ where: { isActive: true, quantity: { gt: 0 } }, include: { category: true }, orderBy: { name: "asc" } }),
  ]);

  return <NewProjectClient users={JSON.parse(JSON.stringify(users))} components={JSON.parse(JSON.stringify(components))} />;
}