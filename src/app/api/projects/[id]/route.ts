// src/app/api/projects/[id]/route.ts - Single project management
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      teamMembers: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      components: { include: { component: true } },
    },
  });

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // ── Individual add/remove component ──
  if (body.addComponent) {
    const { componentId, quantity } = body.addComponent;
    const comp = await prisma.component.findUnique({ where: { id: componentId } });
    if (!comp) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await prisma.projectComponent.upsert({
      where: { projectId_componentId: { projectId: id, componentId } },
      update: { quantity: { increment: quantity }, totalCost: { increment: quantity * (comp.unitCost || 0) } },
      create: {
        projectId: id, componentId, quantity,
        unitCost: comp.unitCost || 0,
        totalCost: quantity * (comp.unitCost || 0),
      },
    });
  }

  if (body.removeComponent) {
    await prisma.projectComponent.deleteMany({
      where: { projectId: id, componentId: body.removeComponent },
    });
  }

  // ── Individual add/remove team member ──
  if (body.addTeamMember) {
    const { userId: tmUserId, role, hours, rate } = body.addTeamMember;
    const h = parseFloat(hours) || 0;
    const r = parseFloat(rate) || 0;
    await prisma.teamMember.upsert({
      where: { projectId_userId: { projectId: id, userId: tmUserId } },
      update: { role: role || "MEMBER", hours: h, rate: r, cost: h * r },
      create: {
        projectId: id, userId: tmUserId,
        role: role || "MEMBER", hours: h, rate: r, cost: h * r,
      },
    });
  }

  if (body.removeTeamMember) {
    await prisma.teamMember.deleteMany({
      where: { projectId: id, userId: body.removeTeamMember },
    });
  }

  // ── Full replacement: components ──
  if (body.components) {
    await prisma.projectComponent.deleteMany({ where: { projectId: id } });
    for (const comp of body.components) {
      await prisma.projectComponent.create({
        data: {
          projectId: id,
          componentId: comp.componentId,
          quantity: comp.quantity,
          unitCost: comp.unitCost,
          totalCost: comp.quantity * comp.unitCost,
        },
      });
    }
    delete body.components;
  }

  // ── Full replacement: team members ──
  if (body.teamMembers) {
    await prisma.teamMember.deleteMany({ where: { projectId: id } });
    for (const tm of body.teamMembers) {
      await prisma.teamMember.create({
        data: {
          projectId: id,
          userId: tm.userId,
          role: tm.role || "MEMBER",
          hours: tm.hours || 0,
          rate: tm.rate || 0,
          cost: (tm.hours || 0) * (tm.rate || 0),
        },
      });
    }
    delete body.teamMembers;
  }

  // ── Recalculate totals ──
  const componentsTotal = await prisma.projectComponent.aggregate({
    _sum: { totalCost: true },
    where: { projectId: id },
  });

  const membersCost = await prisma.teamMember.aggregate({
    _sum: { cost: true },
    where: { projectId: id },
  });

  // Build update data (exclude special action keys)
  const { addComponent, removeComponent, addTeamMember, removeTeamMember, ...updateFields } = body;

  const laborCost = updateFields.laborCost ?? existing.laborCost;
  const otherCosts = updateFields.otherCosts ?? existing.otherCosts;
  const totalCost = laborCost + otherCosts + (componentsTotal._sum.totalCost || 0) + (membersCost._sum.cost || 0);
  const clientPayment = updateFields.clientPayment ?? existing.clientPayment;
  const profit = clientPayment - totalCost;

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...updateFields,
      totalCost,
      profit,
      remainingPayment: Math.max(0, clientPayment - totalCost),
      paymentStatus: clientPayment >= totalCost ? "PAID" : clientPayment > 0 ? "PARTIAL" : "PENDING",
    },
    include: {
      teamMembers: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      components: { include: { component: true } },
    },
  });

  return NextResponse.json({ success: true, project });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.projectComponent.deleteMany({ where: { projectId: id } });
  await prisma.teamMember.deleteMany({ where: { projectId: id } });
  await prisma.project.delete({ where: { id } });

  return NextResponse.json({ success: true });
}