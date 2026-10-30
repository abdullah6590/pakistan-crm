import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import {
  clientIpIdentities, consumeRateLimit, failedAttemptGuard, RateLimitUnavailableError, recordFailedAttempt, RedisRateLimitStore,
  SqliteRateLimitStore, userRateLimitGuard,
} from "./rate-limit";

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(async () => cleanup?.());

describe("shared rate-limit stores", () => {
  it("shares atomic SQLite counters between limiter instances", async () => {
    const one = new SqliteRateLimitStore(db);
    const two = new SqliteRateLimitStore(db);
    const now = new Date("2026-10-30T10:00:00.000Z");

    expect((await one.consume("shared", 2, 60_000, now)).allowed).toBe(true);
    expect((await two.consume("shared", 2, 60_000, now)).allowed).toBe(true);
    const blocked = await one.consume("shared", 2, 60_000, now);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);
  });

  it("expires a SQLite bucket and recovers automatically", async () => {
    const store = new SqliteRateLimitStore(db);
    const start = new Date("2026-10-30T11:00:00.000Z");
    await store.consume("expiry", 1, 1_000, start);
    expect((await store.consume("expiry", 1, 1_000, start)).allowed).toBe(false);

    const recovered = await store.consume("expiry", 1, 1_000, new Date(start.getTime() + 1_001));
    expect(recovered.allowed).toBe(true);
    expect(recovered.remaining).toBe(0);
  });

  it("uses one atomic Redis script with an expiring shared key", async () => {
    const calls: Array<{ script: string; options: unknown }> = [];
    const client = {
      eval: async (script: string, options: unknown) => {
        calls.push({ script, options });
        return [3, 42_000];
      },
    };
    const store = new RedisRateLimitStore(client);

    const result = await store.consume("tenant-login", 2, 60_000);

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 42_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].script).toContain("INCR");
    expect(calls[0].script).toContain("PEXPIRE");
    expect(calls[0].options).toEqual({ keys: ["crm:rate-limit:tenant-login"], arguments: ["60000"] });
  });

  it("fails closed for hosted multi-instance deployments without the shared service", async () => {
    const previous = process.env.CRM_DEPLOYMENT_PROFILE;
    const previousUrl = process.env.REDIS_URL;
    process.env.CRM_DEPLOYMENT_PROFILE = "hosted-multi";
    delete process.env.REDIS_URL;
    try {
      await expect(consumeRateLimit(db, "sensitive", ["tenant", "t1", "user", "u1"]))
        .rejects.toBeInstanceOf(RateLimitUnavailableError);
    } finally {
      if (previous === undefined) delete process.env.CRM_DEPLOYMENT_PROFILE;
      else process.env.CRM_DEPLOYMENT_PROFILE = previous;
      if (previousUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousUrl;
    }
  });
});

describe("sign-in limits on a shared PC, desktop or office server", () => {
  const login = (email: string) => [["tenant", "default", "email", email]];

  it("reading a counter does not add to it", async () => {
    const store = new SqliteRateLimitStore(db);
    const now = new Date("2026-10-30T12:00:00.000Z");
    expect(await store.peek("peek-only", now)).toEqual({ count: 0, retryAfterMs: 0 });
    await store.consume("peek-only", 5, 60_000, now);
    for (let i = 0; i < 3; i++) expect((await store.peek("peek-only", now)).count).toBe(1);
    expect(await store.peek("peek-only", new Date(now.getTime() + 60_001))).toEqual({ count: 0, retryAfterMs: 0 });
  });

  it("correct sign-ins never use up the limit: 25 people signing in on one server are all let in", async () => {
    for (let i = 0; i < 25; i++) expect(await failedAttemptGuard(db, "login", login(`staff${i}@shop.test`))).toBeNull();
    // The same person signing in again and again is not counted either
    for (let i = 0; i < 25; i++) expect(await failedAttemptGuard(db, "login", login("busy@shop.test"))).toBeNull();
  });

  it("wrong passwords block only that e-mail, not everyone else on the server", async () => {
    for (let i = 0; i < 10; i++) await recordFailedAttempt(db, "login", login("guesser@shop.test"));
    const blocked = await failedAttemptGuard(db, "login", login("guesser@shop.test"));
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await failedAttemptGuard(db, "login", login("colleague@shop.test"))).toBeNull();
  });

  it("without a trusted proxy there is no shared address bucket; behind one the address is counted", () => {
    const request = new Request("http://127.0.0.1/api/auth/login", { headers: { "x-forwarded-for": "203.0.113.7" } });
    const previous = process.env.CRM_TRUST_PROXY;
    try {
      delete process.env.CRM_TRUST_PROXY;
      expect(clientIpIdentities(request)).toEqual([]);
      process.env.CRM_TRUST_PROXY = "1";
      expect(clientIpIdentities(request, ["tenant", "t1"])).toEqual([["tenant", "t1", "ip", "203.0.113.7"]]);
    } finally {
      if (previous === undefined) delete process.env.CRM_TRUST_PROXY;
      else process.env.CRM_TRUST_PROXY = previous;
    }
  });

  it("one administrator's many sensitive actions do not block another administrator on the same server", async () => {
    const request = new Request("http://127.0.0.1/api/users");
    for (let i = 0; i < 30; i++) expect(await userRateLimitGuard(db, request, "sensitive", "admin-one")).toBeNull();
    expect((await userRateLimitGuard(db, request, "sensitive", "admin-one"))?.status).toBe(429);
    expect(await userRateLimitGuard(db, request, "sensitive", "admin-two")).toBeNull();
  });

  it("the Redis store reads a counter in one call without changing it", async () => {
    const calls: Array<{ script: string }> = [];
    const store = new RedisRateLimitStore({ eval: async (script: string) => { calls.push({ script }); return [7, 9_000]; } });
    expect(await store.peek("k")).toEqual({ count: 7, retryAfterMs: 9_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].script).toContain("GET");
    expect(calls[0].script).not.toContain("INCR");
  });
});
