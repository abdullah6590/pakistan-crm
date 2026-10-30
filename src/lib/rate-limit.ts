import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import { currentTenantId } from "./tenancy/context";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: Date): Promise<RateLimitResult>;
  /** The bucket's current count without adding to it (0 when it has expired or never existed). */
  peek(key: string, now?: Date): Promise<{ count: number; retryAfterMs: number }>;
}

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Rate-limit protection is temporarily unavailable");
  }
}

export class SqliteRateLimitStore implements RateLimitStore {
  constructor(private readonly db: PrismaClient) {}

  async consume(key: string, limit: number, windowMs: number, now = new Date()): Promise<RateLimitResult> {
    const expires = new Date(now.getTime() + windowMs);
    const rows = await this.db.$queryRawUnsafe<Array<{ count: number | bigint; expiresAt: string | Date }>>(
      `INSERT INTO "rate_limit_buckets" ("key", "count", "windowStart", "expiresAt")
       VALUES (?, 1, ?, ?)
       ON CONFLICT("key") DO UPDATE SET
         "count" = CASE WHEN "expiresAt" <= excluded."windowStart" THEN 1 ELSE "count" + 1 END,
         "windowStart" = CASE WHEN "expiresAt" <= excluded."windowStart" THEN excluded."windowStart" ELSE "windowStart" END,
         "expiresAt" = CASE WHEN "expiresAt" <= excluded."windowStart" THEN excluded."expiresAt" ELSE "expiresAt" END
       RETURNING "count", "expiresAt"`,
      key,
      now.toISOString(),
      expires.toISOString(),
    );
    const count = Number(rows[0].count);
    const expiry = rows[0].expiresAt instanceof Date ? rows[0].expiresAt : new Date(rows[0].expiresAt);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: Math.max(0, expiry.getTime() - now.getTime()),
    };
  }

  async peek(key: string, now = new Date()) {
    const rows = await this.db.$queryRawUnsafe<Array<{ count: number | bigint; expiresAt: string | Date }>>(
      `SELECT "count", "expiresAt" FROM "rate_limit_buckets" WHERE "key" = ? AND "expiresAt" > ?`,
      key,
      now.toISOString(),
    );
    if (!rows.length) return { count: 0, retryAfterMs: 0 };
    const expiry = rows[0].expiresAt instanceof Date ? rows[0].expiresAt : new Date(rows[0].expiresAt);
    return { count: Number(rows[0].count), retryAfterMs: Math.max(0, expiry.getTime() - now.getTime()) };
  }
}

interface RedisEvalClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const REDIS_FIXED_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

// Reads a bucket without changing it (a missing key reads as 0)
const REDIS_PEEK = `
local count = redis.call('GET', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
return {count or 0, ttl}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisEvalClient) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const value = await this.client.eval(REDIS_FIXED_WINDOW, {
      keys: [`crm:rate-limit:${key}`],
      arguments: [String(windowMs)],
    });
    const [rawCount, rawTtl] = value as [number | string, number | string];
    const count = Number(rawCount);
    const ttl = Math.max(0, Number(rawTtl));
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs: ttl };
  }

  async peek(key: string) {
    const value = await this.client.eval(REDIS_PEEK, { keys: [`crm:rate-limit:${key}`], arguments: [] });
    const [rawCount, rawTtl] = value as [number | string | null, number | string];
    return { count: Number(rawCount ?? 0), retryAfterMs: Math.max(0, Number(rawTtl)) };
  }
}

export const RATE_LIMIT_POLICIES = {
  // Failed sign-ins for one account from browsers it has not signed in on before (the account's real user keeps
  // signing in from a recognised browser, so guessing at an account cannot lock its user out; login-protection.ts)
  login: { limit: 10, windowMs: 15 * 60_000 },
  // Failed sign-ins for one account from one browser where it signed in before
  loginKnownDevice: { limit: 10, windowMs: 15 * 60_000 },
  // Failed sign-ins from one address, any account (only behind a trusted proxy, where the address is known)
  loginSource: { limit: 30, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  sensitive: { limit: 30, windowMs: 15 * 60_000 },
  // Backup settings, backup folder choice, Drive folder and upload settings
  backupSettings: { limit: 30, windowMs: 15 * 60_000 },
  // Work that copies a whole database: Back up now, Drive upload now, the older JSON export
  backupRun: { limit: 12, windowMs: 60 * 60_000 },
  // Preparing a restore decrypts and copies a whole database
  restorePrepare: { limit: 20, windowMs: 60 * 60_000 },
  // Restores that could not be prepared (wrong passphrase, unreadable file): guards passphrase guessing
  restoreFailed: { limit: 5, windowMs: 60 * 60_000 },
  // The older JSON restore (it replaces data, so it stays strict)
  restore: { limit: 3, windowMs: 60 * 60_000 },
} as const;

export type RateLimitPolicy = keyof typeof RATE_LIMIT_POLICIES;

let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnect: Promise<unknown> | null = null;

async function hostedStore(): Promise<RateLimitStore> {
  const url = process.env.REDIS_URL;
  if (!url) throw new RateLimitUnavailableError();
  if (!redisClient) {
    redisClient = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    redisClient.on("error", () => undefined);
    redisConnect = redisClient.connect();
  }
  try {
    await redisConnect;
    return new RedisRateLimitStore(redisClient as unknown as RedisEvalClient);
  } catch {
    redisClient = null;
    redisConnect = null;
    throw new RateLimitUnavailableError();
  }
}

async function selectedStore(db: PrismaClient) {
  if (process.env.CRM_DEPLOYMENT_PROFILE === "hosted-multi") return hostedStore();
  return new SqliteRateLimitStore(db);
}

function privateKey(parts: string[]) {
  const secret = process.env.RATE_LIMIT_KEY_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new RateLimitUnavailableError();
  return createHmac("sha256", secret).update(parts.join("\u001f")).digest("hex");
}

export async function consumeRateLimit(
  db: PrismaClient,
  policyName: keyof typeof RATE_LIMIT_POLICIES,
  identityParts: string[],
) {
  const policy = RATE_LIMIT_POLICIES[policyName];
  try {
    const store = await selectedStore(db);
    return await store.consume(privateKey([policyName, ...identityParts]), policy.limit, policy.windowMs);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;
    if (process.env.CRM_DEPLOYMENT_PROFILE === "hosted-multi") {
      redisClient?.destroy();
      redisClient = null;
      redisConnect = null;
    }
    console.error("Rate-limit backend unavailable", { backend: process.env.CRM_DEPLOYMENT_PROFILE === "hosted-multi" ? "redis" : "sqlite", policy: policyName });
    throw new RateLimitUnavailableError();
  }
}

/**
 * How many proxies in front of this server add to X-Forwarded-For (CRM_TRUST_PROXY, a whole number; 0 or unset: none,
 * and forwarded addresses are ignored). Only set it when every request reaches the server through those proxies.
 */
export function trustedProxyHops() {
  const hops = Number(process.env.CRM_TRUST_PROXY ?? 0);
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 0;
}

function requireTrustedProxyWhenHosted() {
  if (process.env.CRM_DEPLOYMENT_PROFILE === "hosted-multi" && trustedProxyHops() === 0) {
    throw new RateLimitUnavailableError();
  }
}

function tooMany(policyName: keyof typeof RATE_LIMIT_POLICIES, retryAfterMs: number) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "RateLimit-Policy": policyName } },
  );
}

function unavailable(policyName: keyof typeof RATE_LIMIT_POLICIES) {
  console.error("Sensitive operation refused: rate-limit protection unavailable", { policy: policyName });
  return Response.json(
    { error: "This protected operation is temporarily unavailable." },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

/** Counts this request against every identity and refuses it when any of them is over its limit. */
export async function rateLimitGuard(
  db: PrismaClient,
  policyName: keyof typeof RATE_LIMIT_POLICIES,
  identities: string[][],
): Promise<Response | null> {
  try {
    requireTrustedProxyWhenHosted();
    let blocked = false;
    let retryAfterMs = 0;
    for (const identity of identities) {
      const result = await consumeRateLimit(db, policyName, identity);
      if (!result.allowed) {
        blocked = true;
        retryAfterMs = Math.max(retryAfterMs, result.retryAfterMs);
      }
    }
    return blocked ? tooMany(policyName, retryAfterMs) : null;
  } catch {
    return unavailable(policyName);
  }
}

/**
 * Failed-attempt limits (sign-in): checks the counters without adding to them. Only a failed attempt is counted,
 * through recordFailedAttempt, so people who sign in correctly never use up the limit.
 */
export async function failedAttemptGuard(
  db: PrismaClient,
  policyName: keyof typeof RATE_LIMIT_POLICIES,
  identities: string[][],
): Promise<Response | null> {
  const policy = RATE_LIMIT_POLICIES[policyName];
  try {
    requireTrustedProxyWhenHosted();
    const store = await selectedStore(db);
    let retryAfterMs = 0;
    let blocked = false;
    for (const identity of identities) {
      const current = await store.peek(privateKey([policyName, ...identity]));
      if (current.count >= policy.limit) {
        blocked = true;
        retryAfterMs = Math.max(retryAfterMs, current.retryAfterMs);
      }
    }
    return blocked ? tooMany(policyName, retryAfterMs) : null;
  } catch {
    return unavailable(policyName);
  }
}

/** Counts one failed attempt against every identity. A counter that cannot be written is logged, not hidden. */
export async function recordFailedAttempt(db: PrismaClient, policyName: keyof typeof RATE_LIMIT_POLICIES, identities: string[][]) {
  for (const identity of identities) {
    try {
      await consumeRateLimit(db, policyName, identity);
    } catch {
      console.error("Could not record a failed attempt", { policy: policyName });
    }
  }
}

/**
 * The caller's address as an identity, only when a trusted proxy reports it. On a PC, desktop or office server every
 * request would otherwise share one "address", and a limit on it would lock out everyone at once.
 */
export function clientIpIdentities(request: Request, scope: string[] = []): string[][] {
  if (trustedProxyHops() === 0) return [];
  return [[...scope, "ip", trustedClientIp(request)]];
}

/**
 * The client address as the trusted proxies report it. Each proxy appends the address it received the request from,
 * so the entries a client wrote itself are on the left and cannot be trusted: with N trusted proxies the client is the
 * Nth entry from the right. Fewer entries than proxies means the request did not come through them ("unknown").
 */
export function trustedClientIp(request: Request) {
  const hops = trustedProxyHops();
  if (hops === 0) return "local";
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain.length >= hops ? chain[chain.length - hops] : "unknown";
}

/**
 * Limits on signed-in work count per user (in this business). The address is not counted: the user is already known,
 * and several administrators behind one office router would otherwise share a limit.
 */
export async function userIdentities(userId: string) {
  return [["tenant", await currentTenantId(), "user", userId]];
}

export async function userRateLimitGuard(
  db: PrismaClient,
  request: Request,
  policyName: keyof typeof RATE_LIMIT_POLICIES,
  userId: string,
) {
  return rateLimitGuard(db, policyName, await userIdentities(userId));
}
