import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function hashIp(ip: string | undefined) {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

export async function createSession(
  db: PrismaClient,
  userId: string,
  metadata: { userAgent?: string; ip?: string },
) {
  return db.session.create({
    data: newSessionData(userId, metadata),
  });
}

export function newSessionData(userId: string, metadata: { userAgent?: string; ip?: string }) {
  const now = new Date();
  return {
    id: randomUUID(),
    sessionToken: randomBytes(32).toString("base64url"),
    userId,
    expires: new Date(now.getTime() + SESSION_AGE_MS),
    createdAt: now,
    lastSeenAt: now,
    userAgent: metadata.userAgent?.slice(0, 255) || null,
    ipHash: hashIp(metadata.ip),
  };
}

export async function resolveSession(db: PrismaClient, sessionId: string) {
  const session = await db.session.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expires: { gt: new Date() },
      user: { isActive: true },
    },
    include: { user: true },
  });
  if (!session) return null;
  const now = new Date();
  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastSeenAt: now } });
  }
  return session;
}

export async function revokeSession(
  db: PrismaClient,
  userId: string,
  sessionId: string,
  reason = "USER_LOGOUT",
) {
  return db.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

export async function revokeAllUserSessions(db: PrismaClient, userId: string, reason: string) {
  return db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}
