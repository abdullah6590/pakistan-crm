// src/middleware.ts - Route protection middleware
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("CRITICAL ERROR: JWT_SECRET environment variable is not set.");
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Routes that require specific roles
const roleRouteMap: Record<string, string[]> = {
  "/dashboard/users": ["ADMIN"],
  "/dashboard/partners": ["ADMIN", "PARTNER"],
  "/dashboard/finance": ["ADMIN", "ACCOUNTANT", "PARTNER"],
  "/dashboard/reports": ["ADMIN", "ACCOUNTANT", "PARTNER"],
  "/dashboard/purchases": ["ADMIN", "INVENTORY_MANAGER"],
  "/dashboard/suppliers": ["ADMIN", "INVENTORY_MANAGER"],
  "/dashboard/inventory": ["ADMIN", "INVENTORY_MANAGER", "EMPLOYEE"],
  "/dashboard/accounts": ["ADMIN", "ACCOUNTANT"],
  "/dashboard/transfers": ["ADMIN", "ACCOUNTANT"],
  "/dashboard/expenditures": ["ADMIN", "ACCOUNTANT"],
  "/dashboard/daybook": ["ADMIN", "ACCOUNTANT", "PARTNER"],
  "/dashboard/backup": ["ADMIN"],
  "/dashboard/cash-sales": ["ADMIN", "EMPLOYEE"],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = request.cookies.get("auth-token")?.value;

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userRole = payload.role as string;

    // Check role-based access
    for (const [route, allowedRoles] of Object.entries(roleRouteMap)) {
      if (pathname.startsWith(route) && !allowedRoles.includes(userRole)) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }

    return NextResponse.next();
  } catch {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};