// src/app/api/projects/route.ts - Projects API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { projectSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search") || "";

  const projects = await prisma.project.findMany({
    where: {
      AND: [
        status && status !== "ALL" ? { status: status as any } : {},
        search ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { clientName: { contains: search, mode: "insensitive" } },
            { projectId: { contains: search, mode: "insensitive" } },
          ],
        } : {},
      ],
    },
    include: {
      teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
      components: { include: { component: { select: { id: true, name: true, sku: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      ...parsed.data,
      userId: user.userId,
    },
  });

  if (body.teamMembers && Array.isArray(body.teamMembers)) {
    for (const tm of body.teamMembers) {
      await prisma.teamMember.create({
        data: {
          projectId: project.id,
          userId: tm.userId,
          role: tm.role || "MEMBER",
          hours: tm.hours || 0,
          rate: tm.rate || 0,
          cost: (tm.hours || 0) * (tm.rate || 0),
        },
      });
    }
  }

  if (body.components && Array.isArray(body.components)) {
    for (const comp of body.components) {
      const dbComp = await prisma.component.findUnique({ where: { id: comp.componentId } });
      if (dbComp) {
        await prisma.projectComponent.create({
          data: {
            projectId: project.id,
            componentId: comp.componentId,
            quantity: comp.quantity,
            unitCost: dbComp.unitCost || 0,
            totalCost: comp.quantity * (dbComp.unitCost || 0),
          },
        });
      }
    }
  }

  return NextResponse.json({ success: true, project }, { status: 201 });
}