// Sign-in protection (Phase 0). Only failed attempts are counted, so people who sign in correctly never use up a limit.
//
// - Account: failed sign-ins for one account from browsers it has not signed in on before (10 per 15 minutes).
// - Recognised browser: after a correct sign-in the browser keeps a signed cookie for that account. Its failed attempts
//   are counted on their own (10 per 15 minutes), so someone guessing at an account from elsewhere cannot lock the
//   account's user out of the browser they normally use. This is OWASP's "device cookie" approach.
// - Address: behind trusted proxies (hosted), failed sign-ins from one address across all accounts (30 per 15 minutes),
//   against password spraying. Without a trusted proxy (PC, office server, desktop) the address is unknown and not used.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { NextResponse } from "next/server";
import { clientIpIdentities, failedAttemptGuard, RateLimitUnavailableError, recordFailedAttempt } from "./rate-limit";

const DEVICE_COOKIE_PREFIX = "crm-kd-";
const DEVICE_COOKIE_AGE_S = 180 * 24 * 60 * 60;

function secret() {
  const value = process.env.RATE_LIMIT_KEY_SECRET || process.env.JWT_SECRET;
  if (!value) throw new RateLimitUnavailableError();
  return value;
}

function sign(parts: string[]) {
  return createHmac("sha256", secret()).update(["known-device", ...parts].join("\u001f")).digest("base64url");
}

/** One cookie per account per browser, so people sharing a PC each keep their own. The name reveals nothing. */
export function deviceCookieName(tenantId: string, email: string) {
  return DEVICE_COOKIE_PREFIX + sign(["name", tenantId, email.toLowerCase()]).slice(0, 16);
}

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The recognised-browser id for this account, or null when the browser has no valid cookie for it. */
export function knownDeviceId(request: Request, tenantId: string, email: string, now = Date.now()) {
  const value = readCookie(request, deviceCookieName(tenantId, email));
  const [id, issued, mac] = value?.split(".") ?? [];
  if (!id || !issued || !mac) return null;
  const expected = Buffer.from(sign([tenantId, email.toLowerCase(), id, issued]));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const age = now - Number(issued);
  return Number.isFinite(age) && age >= 0 && age < DEVICE_COOKIE_AGE_S * 1000 ? id : null;
}

export function issueDeviceCookie(response: NextResponse, tenantId: string, email: string, existingId: string | null) {
  const id = existingId ?? randomUUID();
  const issued = String(Date.now());
  response.cookies.set(deviceCookieName(tenantId, email), `${id}.${issued}.${sign([tenantId, email.toLowerCase(), id, issued])}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: DEVICE_COOKIE_AGE_S,
    path: "/api/auth",
  });
}

/** Works out which counters a sign-in attempt for this account belongs to. */
export function loginAttempt(db: PrismaClient, request: Request, tenantId: string, email: string) {
  const account = ["tenant", tenantId, "email", email.toLowerCase()];
  const deviceId = knownDeviceId(request, tenantId, email);
  const checks: Array<{ policy: "login" | "loginKnownDevice" | "loginSource"; identities: string[][] }> = deviceId
    ? [{ policy: "loginKnownDevice", identities: [[...account, "device", deviceId]] }]
    : [{ policy: "login", identities: [account] }, { policy: "loginSource", identities: clientIpIdentities(request) }];
  return {
    deviceId,
    /** A 429 (or 503 when protection is unavailable) when this attempt must be refused before checking the password. */
    async refused(): Promise<Response | null> {
      for (const { policy, identities } of checks) {
        if (!identities.length) continue;
        const refused = await failedAttemptGuard(db, policy, identities);
        if (refused) return refused;
      }
      return null;
    },
    async failed() {
      for (const { policy, identities } of checks) if (identities.length) await recordFailedAttempt(db, policy, identities);
    },
    succeeded(response: NextResponse) {
      issueDeviceCookie(response, tenantId, email, deviceId);
    },
  };
}
