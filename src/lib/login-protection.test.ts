import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { deviceCookieName, knownDeviceId, loginAttempt } from "./login-protection";
import { trustedClientIp } from "./rate-limit";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const saved = { proxy: process.env.CRM_TRUST_PROXY, profile: process.env.CRM_DEPLOYMENT_PROFILE, redis: process.env.REDIS_URL };

beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(async () => cleanup?.());
afterEach(() => {
  for (const [name, value] of [["CRM_TRUST_PROXY", saved.proxy], ["CRM_DEPLOYMENT_PROFILE", saved.profile], ["REDIS_URL", saved.redis]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const loginRequest = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1/api/auth/login", { method: "POST", headers });

/** Signs in correctly once and returns the Cookie header the browser would send next time. */
function recognisedBrowser(tenantId: string, email: string) {
  const response = NextResponse.json({ success: true });
  loginAttempt(db, loginRequest(), tenantId, email).succeeded(response);
  const name = deviceCookieName(tenantId, email);
  return `${name}=${response.cookies.get(name)!.value}`;
}

async function failTimes(n: number, tenantId: string, email: string, headers: Record<string, string> = {}) {
  for (let i = 0; i < n; i++) await loginAttempt(db, loginRequest(headers), tenantId, email).failed();
}

describe("sign-in protection without a trusted proxy (PC, office server, desktop)", () => {
  it("someone guessing at an account cannot lock its user out of the browser they normally use", async () => {
    const cookie = recognisedBrowser("default", "owner@shop.test");
    await failTimes(10, "default", "owner@shop.test");

    const stranger = await loginAttempt(db, loginRequest(), "default", "owner@shop.test").refused();
    expect(stranger?.status).toBe(429);
    expect(await loginAttempt(db, loginRequest({ cookie }), "default", "owner@shop.test").refused()).toBeNull();
  });

  it("a recognised browser has its own limit: ten wrong passwords there block that browser for that account", async () => {
    const cookie = recognisedBrowser("default", "clerk@shop.test");
    await failTimes(10, "default", "clerk@shop.test", { cookie });
    expect((await loginAttempt(db, loginRequest({ cookie }), "default", "clerk@shop.test").refused())?.status).toBe(429);
    // Another of the clerk's browsers is not affected
    const other = recognisedBrowser("default", "clerk@shop.test");
    expect(await loginAttempt(db, loginRequest({ cookie: other }), "default", "clerk@shop.test").refused()).toBeNull();
  });

  it("the browser cookie only counts for the account and business it was issued for, and cannot be forged", () => {
    const cookie = recognisedBrowser("default", "a@shop.test");
    const value = cookie.split("=")[1];
    expect(knownDeviceId(loginRequest({ cookie }), "default", "a@shop.test")).not.toBeNull();
    expect(knownDeviceId(loginRequest({ cookie: `${deviceCookieName("default", "b@shop.test")}=${value}` }), "default", "b@shop.test")).toBeNull();
    expect(knownDeviceId(loginRequest({ cookie: `${deviceCookieName("other", "a@shop.test")}=${value}` }), "other", "a@shop.test")).toBeNull();
    const [id, issued] = value.split(".");
    expect(knownDeviceId(loginRequest({ cookie: `${cookie.split("=")[0]}=${id}.${issued}.forged` }), "default", "a@shop.test")).toBeNull();
    expect(knownDeviceId(loginRequest({ cookie }), "default", "a@shop.test", Number(issued) + 181 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("forwarded addresses are ignored, so a client cannot invent one to dodge or aim a limit", async () => {
    await failTimes(10, "default", "spoof@shop.test", { "x-forwarded-for": "198.51.100.1" });
    const refused = await loginAttempt(db, loginRequest({ "x-forwarded-for": "198.51.100.2" }), "default", "spoof@shop.test").refused();
    expect(refused?.status).toBe(429);
    expect(trustedClientIp(loginRequest({ "x-forwarded-for": "198.51.100.2" }))).toBe("local");
  });
});

describe("sign-in protection behind trusted proxies (hosted)", () => {
  it("reads the client address from the right-hand end of X-Forwarded-For, ignoring what the client wrote", () => {
    process.env.CRM_TRUST_PROXY = "1";
    expect(trustedClientIp(loginRequest({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    // The client sent its own X-Forwarded-For; the proxy appended the real address
    expect(trustedClientIp(loginRequest({ "x-forwarded-for": "10.9.9.9, 203.0.113.9" }))).toBe("203.0.113.9");
    process.env.CRM_TRUST_PROXY = "2";
    expect(trustedClientIp(loginRequest({ "x-forwarded-for": "10.9.9.9, 203.0.113.9, 192.0.2.1" }))).toBe("203.0.113.9");
    expect(trustedClientIp(loginRequest({ "x-forwarded-for": "203.0.113.9" }))).toBe("unknown"); // did not pass both proxies
    expect(trustedClientIp(loginRequest({ "x-real-ip": "203.0.113.9" }))).toBe("unknown");
    process.env.CRM_TRUST_PROXY = "yes";
    expect(trustedClientIp(loginRequest({ "x-forwarded-for": "203.0.113.9" }))).toBe("local"); // not a number of proxies
  });

  it("an address spraying passwords across many accounts is stopped; other addresses and recognised browsers are not", async () => {
    process.env.CRM_TRUST_PROXY = "1";
    const sprayer = { "x-forwarded-for": "203.0.113.50" };
    const cookie = recognisedBrowser("default", "victim@shop.test");
    for (let i = 0; i < 30; i++) await failTimes(1, "default", `user${i}@shop.test`, sprayer);

    expect((await loginAttempt(db, loginRequest(sprayer), "default", "fresh@shop.test").refused())?.status).toBe(429);
    expect(await loginAttempt(db, loginRequest({ "x-forwarded-for": "203.0.113.51" }), "default", "fresh@shop.test").refused()).toBeNull();
    // The real user on a browser they signed in on before, even behind the same address (an office router), gets in
    expect(await loginAttempt(db, loginRequest({ ...sprayer, cookie }), "default", "victim@shop.test").refused()).toBeNull();
  });

  it("hosted multi-instance sign-in refuses (503) rather than running unprotected when the shared store is missing", async () => {
    process.env.CRM_TRUST_PROXY = "1";
    process.env.CRM_DEPLOYMENT_PROFILE = "hosted-multi";
    delete process.env.REDIS_URL;
    expect((await loginAttempt(db, loginRequest({ "x-forwarded-for": "203.0.113.60" }), "default", "x@shop.test").refused())?.status).toBe(503);
    delete process.env.CRM_TRUST_PROXY;
    expect((await loginAttempt(db, loginRequest(), "default", "x@shop.test").refused())?.status).toBe(503);
  });
});
