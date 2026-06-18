// src/app/(dashboard)/projects/[id]/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { ProjectDetailClient } from "./project-detail-client";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
      components: { include: { component: { include: { category: true } } } },
    },
  });

  if (!project) notFound();

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, role: true },
  });

  const components = await prisma.component.findMany({
    where: { isActive: true },
    include: { category: true },
    orderBy: { name: "asc" },
  });

  return <ProjectDetailClient
    project={JSON.parse(JSON.stringify(project))}
    users={JSON.parse(JSON.stringify(users))}
    components={JSON.parse(JSON.stringify(components))}
    currentUserRole={user.role}
  />;
}