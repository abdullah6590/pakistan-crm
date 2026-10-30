// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { revokeSession } from "@/lib/auth-sessions";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  const auth = await getAuthSession();
  if (auth) await revokeSession(prisma, auth.user.id, auth.sessionId, "USER_LOGOUT");
  const url = new URL("/login", request.url);
  const response = NextResponse.redirect(url);

  response.cookies.set("auth-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}
