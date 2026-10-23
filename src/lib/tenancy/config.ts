// src/lib/tenancy/config.ts - Runtime role and tenancy mode (Report 20 §2.1, §2.2).
// cloud  = central ledger authority (single- or multi-tenant)
// hub    = office relay with a replica (Mode A)
// device = desktop with an encrypted replica and an outbox
export type NodeRole = "cloud" | "hub" | "device";
export type TenancyMode = "single" | "multi";

export function nodeRole(): NodeRole {
  const r = (process.env.CRM_NODE_ROLE ?? "cloud").toLowerCase();
  if (r !== "cloud" && r !== "hub" && r !== "device") throw new Error(`CRM_NODE_ROLE must be cloud, hub or device (got "${r}")`);
  return r;
}

/** Single mode (default) keeps today's behaviour: one database from DATABASE_URL. */
export function tenancyMode(): TenancyMode {
  const m = (process.env.CRM_TENANCY ?? "single").toLowerCase();
  if (m !== "single" && m !== "multi") throw new Error(`CRM_TENANCY must be single or multi (got "${m}")`);
  if (m === "multi" && nodeRole() !== "cloud") throw new Error("Only the cloud role serves several tenants; hubs and devices hold one tenant");
  return m;
}

export const DEFAULT_TENANT_ID = "default";
