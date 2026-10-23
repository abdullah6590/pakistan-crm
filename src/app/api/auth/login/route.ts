// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { hashPassword, verifyPassword, createToken } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import prisma from "@/lib/prisma";
import { isLimited, recordFailure, clearFailures } from "@/lib/rate-limit";
import { tenancyMode, DEFAULT_TENANT_ID } from "@/lib/tenancy/config";
import { getTenantBySlug } from "@/lib/tenancy/registry";
import { runWithTenant } from "@/lib/tenancy/context";

export async function POST(request: Request) {
  // Multi-tenant: the business named at sign-in selects the database; everything below runs inside it
  let tenantId = DEFAULT_TENANT_ID;
  if (tenancyMode() === "multi") {
    const body = await request.clone().json().catch(() => ({}));
    const tenant = typeof body?.business === "string" && body.business ? await getTenantBySlug(body.business) : null;
    if (!tenant || tenant.status !== "ACTIVE") return NextResponse.json({ error: "Invalid business, email or password" }, { status: 401 });
    tenantId = tenant.id;
  }
  return runWithTenant(tenantId, () => login(request, tenantId));
}

async function login(request: Request, tenantId: string) {
  try {
    const body = await request.json();

    // Validate input
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid credentials", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const limitKeys = [`login:email:${tenantId}:${email.toLowerCase()}`, `login:ip:${ip}`];
    if (isLimited(limitKeys)) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Try again in 15 minutes." },
        { status: 429 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      recordFailure(limitKeys);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: "Account has been deactivated. Contact admin." },
        { status: 403 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      recordFailure(limitKeys);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    clearFailures(limitKeys);

    // Create JWT token
    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId,
    });

    // Set cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    });

    response.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}