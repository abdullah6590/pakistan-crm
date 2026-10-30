import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";
import { revokeSession } from "@/lib/auth-sessions";
import { userRateLimitGuard } from "@/lib/rate-limit";

export async function GET() {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await prisma.session.findMany({
    where: { userId: auth.user.id, revokedAt: null, expires: { gt: new Date() } },
    select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, expires: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    sessions: sessions.map((session) => ({ ...session, current: session.id === auth.sessionId })),
  });
}

export async function DELETE(request: Request) {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await userRateLimitGuard(prisma, request, "sensitive", auth.user.id);
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  if (typeof body.sessionId !== "string") {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  const result = await revokeSession(prisma, auth.user.id, body.sessionId, "DEVICE_REVOKED");
  if (!result.count) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
