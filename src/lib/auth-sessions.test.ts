import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createSession, resolveSession, revokeAllUserSessions, revokeSession } from "./auth-sessions";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  userId = (await db.user.create({
    data: { name: "Session User", email: "sessions@test.local", password: "x", role: "ADMIN" },
  })).id;
});

afterAll(async () => cleanup?.());

describe("server-side session registry", () => {
  it("resolves an active session and returns the current database role", async () => {
    const issued = await createSession(db, userId, { userAgent: "test browser", ip: "127.0.0.1" });
    await db.user.update({ where: { id: userId }, data: { role: "ACCOUNTANT" } });

    const resolved = await resolveSession(db, issued.id);

    expect(resolved?.user.role).toBe("ACCOUNTANT");
    expect(resolved?.id).toBe(issued.id);
  });

  it("stamps new sessions with their creation time and still accepts a session row made before the update", async () => {
    const issued = await createSession(db, userId, {});
    expect(issued.createdAt).toBeInstanceOf(Date);
    // A row that existed before the Phase 0 update has no creation time (the column was added empty)
    await db.session.update({ where: { id: issued.id }, data: { createdAt: null } });
    expect((await resolveSession(db, issued.id))?.id).toBe(issued.id);
    const listed = await db.session.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
    expect(listed.find((s) => s.id === issued.id)?.createdAt).toBeNull();
  });

  it("rejects an individually revoked session while leaving another device active", async () => {
    const first = await createSession(db, userId, { userAgent: "device one" });
    const second = await createSession(db, userId, { userAgent: "device two" });

    await revokeSession(db, userId, first.id, "DEVICE_REVOKED");

    expect(await resolveSession(db, first.id)).toBeNull();
    expect(await resolveSession(db, second.id)).not.toBeNull();
  });

  it("immediately rejects all sessions after account deactivation or security changes", async () => {
    const issued = await createSession(db, userId, {});
    await revokeAllUserSessions(db, userId, "ACCOUNT_CHANGED");
    expect(await resolveSession(db, issued.id)).toBeNull();

    const activeAgain = await createSession(db, userId, {});
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await resolveSession(db, activeAgain.id)).toBeNull();
  });
});
