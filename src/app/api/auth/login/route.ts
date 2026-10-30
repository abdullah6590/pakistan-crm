// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { hashPassword, verifyPassword, createToken } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import prisma from "@/lib/prisma";
import { trustedClientIp } from "@/lib/rate-limit";
import { loginAttempt } from "@/lib/login-protection";
import { tenancyMode, DEFAULT_TENANT_ID } from "@/lib/tenancy/config";
import { getTenantBySlug } from "@/lib/tenancy/registry";
import { runWithTenant } from "@/lib/tenancy/context";
import { createSession } from "@/lib/auth-sessions";

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

    const ip = trustedClientIp(request);
    // Only failed attempts count; a browser where this account signed in before has its own counter, so guessing at
    // an account cannot lock its user out (src/lib/login-protection.ts)
    const attempt = loginAttempt(prisma, request, tenantId, email);
    const limited = await attempt.refused();
    if (limited) return limited;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await attempt.failed();
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      await attempt.failed();
      return NextResponse.json(
        { error: "Account has been deactivated. Contact admin." },
        { status: 403 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      await attempt.failed();
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const session = await createSession(prisma, user.id, {
      userAgent: request.headers.get("user-agent") || undefined,
      ip,
    });
    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
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
    attempt.succeeded(response);

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
