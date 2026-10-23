// src/app/api/users/[id]/route.ts - Single user management
import { NextRequest, NextResponse } from "next/server";
import { isAuthority, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";
import { prisma } from "@/lib/prisma";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { hash } from "bcryptjs";

const USER_ROLES = ["ADMIN", "PARTNER", "EMPLOYEE", "INVENTORY_MANAGER", "ACCOUNTANT"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authUser = await getAuthUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Users may read their own profile; other profiles are ADMIN-only (audit SEC-18)
  if (!isAdmin(authUser.role) && authUser.id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, phone: true, image: true, isActive: true, address: true, createdAt: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Users are replicated to devices for offline sign-in; only the cloud may change them
  if (!isAuthority()) return NextResponse.json({ error: OFFLINE_ONLY_MESSAGE }, { status: 503 });
  const { id } = await params;
  const authUser = await getAuthUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(authUser.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const data: any = {};

  if (body.name) data.name = body.name;
  if (body.email) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.role) {
    if (!USER_ROLES.includes(body.role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    data.role = body.role;
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.address !== undefined) data.address = body.address;
  if (body.password) data.password = await hash(body.password, 12);

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, phone: true, isActive: true },
  });

  return NextResponse.json({ success: true, user });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Users are replicated to devices for offline sign-in; only the cloud may change them
  if (!isAuthority()) return NextResponse.json({ error: OFFLINE_ONLY_MESSAGE }, { status: 503 });
  const { id } = await params;
  const authUser = await getAuthUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(authUser.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}