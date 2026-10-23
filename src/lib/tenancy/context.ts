// src/lib/tenancy/context.ts - Which tenant the current request or job belongs to.
// Explicit context (sync endpoints authenticated by device credentials, background jobs, tests) wins;
// otherwise the tenant comes from the signed session cookie; single mode always uses the default tenant.
import { AsyncLocalStorage } from "node:async_hooks";
import { jwtVerify } from "jose";
import { DEFAULT_TENANT_ID, tenancyMode } from "./config";

const store = new AsyncLocalStorage<{ tenantId: string }>();

export function runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ tenantId }, fn);
}

export function explicitTenant(): string | null {
  return store.getStore()?.tenantId ?? null;
}

/** Tenant id from the session token, verified with JWT_SECRET. */
export async function tenantFromToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET ?? ""));
    return typeof payload.tenantId === "string" ? payload.tenantId : null;
  } catch {
    return null;
  }
}

export class TenantContextError extends Error {}

export async function currentTenantId(): Promise<string> {
  const explicit = explicitTenant();
  if (explicit) return explicit;
  if (tenancyMode() === "single") return DEFAULT_TENANT_ID;
  let token: string | undefined;
  try {
    const { cookies } = await import("next/headers");
    token = (await cookies()).get("auth-token")?.value;
  } catch {
    throw new TenantContextError("No tenant context: not inside a request and no explicit tenant");
  }
  const tenantId = token ? await tenantFromToken(token) : null;
  if (!tenantId) throw new TenantContextError("No tenant in the session");
  return tenantId;
}
