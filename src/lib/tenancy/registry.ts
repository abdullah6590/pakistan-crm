// src/lib/tenancy/registry.ts - Control database: which tenants exist and where each tenant's database lives.
// Database-per-tenant (Report 20 §2.2): business data never shares a database with another tenant.
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { DEFAULT_TENANT_ID, tenancyMode } from "./config";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  dbUrl: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  createdAt: string;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, db_url TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`;

let control: Client | null = null;
let controlUrl: string | null = null;

function controlClient(): Client {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error("CONTROL_DATABASE_URL is required in multi-tenant mode");
  if (!control || controlUrl !== url) {
    control = createClient({ url });
    controlUrl = url;
  }
  return control;
}

function row(r: Record<string, unknown>): Tenant {
  return { id: String(r.id), slug: String(r.slug), name: String(r.name), dbUrl: String(r.db_url), status: String(r.status) as Tenant["status"], createdAt: String(r.created_at) };
}

export async function initControl(): Promise<void> {
  await controlClient().execute(SCHEMA);
}

/** The single tenant of a single-tenant cloud, hub or device: the database in DATABASE_URL. */
export function defaultTenant(): Tenant {
  return { id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_ID, name: "Default", dbUrl: process.env.DATABASE_URL || "file:./dev.db", status: "ACTIVE", createdAt: "" };
}

export async function getTenant(id: string): Promise<Tenant | null> {
  if (tenancyMode() === "single") return id === DEFAULT_TENANT_ID ? defaultTenant() : null;
  await initControl();
  const r = await controlClient().execute({ sql: "SELECT * FROM tenants WHERE id = ?", args: [id] });
  return r.rows[0] ? row(r.rows[0] as Record<string, unknown>) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  if (tenancyMode() === "single") return defaultTenant();
  await initControl();
  const r = await controlClient().execute({ sql: "SELECT * FROM tenants WHERE slug = ?", args: [slug.trim().toLowerCase()] });
  return r.rows[0] ? row(r.rows[0] as Record<string, unknown>) : null;
}

export async function listTenants(): Promise<Tenant[]> {
  if (tenancyMode() === "single") return [defaultTenant()];
  await initControl();
  return (await controlClient().execute("SELECT * FROM tenants ORDER BY created_at")).rows.map((r) => row(r as Record<string, unknown>));
}

/** Register a tenant whose database lives under TENANT_DB_DIR (one file per tenant). Does not create users. */
export async function registerTenant(input: { slug: string; name: string }): Promise<Tenant> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new Error("Tenant slug: 2-41 lowercase letters, digits or hyphens");
  const dir = process.env.TENANT_DB_DIR;
  if (!dir) throw new Error("TENANT_DB_DIR is required to create tenant databases");
  fs.mkdirSync(dir, { recursive: true });
  const id = `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const dbUrl = `file:${path.resolve(dir, `${id}.db`).replace(/\\/g, "/")}`;
  await initControl();
  await controlClient().execute({ sql: "INSERT INTO tenants (id, slug, name, db_url) VALUES (?, ?, ?, ?)", args: [id, slug, input.name.trim(), dbUrl] });
  return (await getTenant(id))!;
}

export async function setTenantStatus(id: string, status: Tenant["status"]): Promise<void> {
  // Status changes never delete data; a suspended tenant's database and devices' pending records are kept (Phase 9)
  await initControl();
  await controlClient().execute({ sql: "UPDATE tenants SET status = ? WHERE id = ?", args: [status, id] });
}
