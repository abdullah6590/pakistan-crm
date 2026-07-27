// src/app/api/users/route.ts - User management API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { hash } from "bcryptjs";
import { registerSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const role = searchParams.get("role");

  const users = await prisma.user.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search } },
          ],
        } : {},
        role ? { role: role as any } : {},
      ],
    },
    select: {
      id: true, name: true, email: true, role: true, phone: true,
      image: true, isActive: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(authUser.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });

  const hashedPassword = await hash(parsed.data.password, 12);
  const newUser = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      password: hashedPassword,
      phone: parsed.data.phone || null,
      role: body.role || "EMPLOYEE",
    },
    select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true },
  });

  return NextResponse.json({ success: true, user: newUser }, { status: 201 });
}