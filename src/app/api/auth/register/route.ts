// src/app/api/auth/register/route.ts
// Public registration is only allowed to bootstrap the very first (ADMIN) account.
// All other users are created by an ADMIN through /api/users (audit SEC-01).
import { NextResponse } from "next/server";
import { hashPassword, createToken } from "@/lib/auth";
import { tenancyMode } from "@/lib/tenancy/config";
import { registerSchema } from "@/lib/validations";
import prisma from "@/lib/prisma";

export async function GET() {
  // Multi-tenant: businesses and their first administrator are created by the platform, not by sign-up
  if (tenancyMode() === "multi") return NextResponse.json({ registrationOpen: false });
  const userCount = await prisma.user.count();
  return NextResponse.json({ registrationOpen: userCount === 0 });
}

export async function POST(request: Request) {
  if (tenancyMode() === "multi") {
    return NextResponse.json({ error: "Registration is closed. Your business account is created by the provider." }, { status: 403 });
  }
  try {
    const body = await request.json();

    // Validate input
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, email, password, phone } = parsed.data;

    // Registration is closed once any user exists; the client-supplied role is never used.
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json(
        { error: "Registration is closed. Ask an administrator to create your account." },
        { status: 403 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create the bootstrap administrator
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: phone || null,
        role: "ADMIN",
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        image: true,
      },
    });

    // Create JWT token
    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Set cookie
    const response = NextResponse.json({
      success: true,
      user,
    });

    response.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
