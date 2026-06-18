// src/app/(dashboard)/users/page.tsx
import { getAuthUser, isAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { UsersClient } from "./users-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!isAdmin(user)) redirect("/dashboard");

  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, phone: true,
      image: true, isActive: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return <UsersClient users={users} />;
}