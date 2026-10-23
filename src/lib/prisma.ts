// src/lib/prisma.ts - Prisma client (Prisma v7 with libsql adapter).
// Single-tenant mode (default): one client for DATABASE_URL, exactly as before.
// Multi-tenant mode (CRM_TENANCY=multi, cloud only): `prisma` resolves to the current tenant's own database on
// every call, so existing queries need no tenant filter and cannot reach another tenant (Report 20 §2.2).
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { tenancyMode } from "./tenancy/config";
import { currentTenantId } from "./tenancy/context";
import { getTenant } from "./tenancy/registry";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  tenantClients: Map<string, PrismaClient> | undefined;
};

/** A client for one database file or URL. CRM_DB_ENCRYPTION_KEY encrypts device and hub databases at rest. */
export function createPrismaClient(url: string, encryptionKey = process.env.CRM_DB_ENCRYPTION_KEY || undefined) {
  const adapter = new PrismaLibSql({ url, encryptionKey });
  return new PrismaClient({ adapter });
}

const tenantClients = globalForPrisma.tenantClients ?? new Map<string, PrismaClient>();
if (process.env.NODE_ENV !== "production") globalForPrisma.tenantClients = tenantClients;

/** The client for a tenant's own database (multi-tenant mode). Suspended tenants keep their data but get no client. */
export async function clientForTenant(tenantId: string): Promise<PrismaClient> {
  const cached = tenantClients.get(tenantId);
  if (cached) return cached;
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error("Unknown tenant");
  if (tenant.status !== "ACTIVE") throw new Error("This business account is not active");
  const client = createPrismaClient(tenant.dbUrl);
  tenantClients.set(tenantId, client);
  return client;
}

function tenantProxy(): PrismaClient {
  const resolve = async () => clientForTenant(await currentTenantId());
  const delegate = (model: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (...args: unknown[]) => {
        const client = (await resolve()) as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
        return client[model][method](...args);
      },
    });
  return new Proxy({} as PrismaClient, {
    get(_t, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (prop.startsWith("$")) {
        return async (...args: unknown[]) => {
          const client = (await resolve()) as unknown as Record<string, (...a: unknown[]) => unknown>;
          return client[prop](...args);
        };
      }
      return delegate(prop);
    },
  });
}

function defaultClient(): PrismaClient {
  return globalForPrisma.prisma ?? createPrismaClient(process.env.DATABASE_URL || "file:./dev.db");
}

export const prisma: PrismaClient = tenancyMode() === "multi" ? tenantProxy() : defaultClient();

if (process.env.NODE_ENV !== "production" && tenancyMode() === "single") globalForPrisma.prisma = prisma;

export default prisma;
