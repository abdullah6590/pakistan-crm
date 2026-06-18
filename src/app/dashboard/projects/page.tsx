// src/app/(dashboard)/projects/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { ProjectsClient } from "./projects-client";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      include: {
        teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
        components: { include: { component: { select: { id: true, name: true, sku: true } } } },
        user: { select: { name: true } },
        _count: { select: { teamMembers: true, components: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);

  return <ProjectsClient projects={JSON.parse(JSON.stringify(projects))} users={users} />;
}