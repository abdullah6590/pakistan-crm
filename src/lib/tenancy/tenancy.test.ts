// Phase 1 foundation: versioned migrations and database-per-tenant isolation (Report 20 §2.2).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { applyMigrations, listMigrations, MIGRATIONS_DIR } from "./migrate";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-tenancy-test-"));
const url = (name: string) => `file:${path.join(dir, name).replace(/\\/g, "/")}`;
const saved = { ...process.env };

afterAll(() => {
  process.env = saved;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
});

describe("versioned migrations", () => {
  it("apply every migration once, record Prisma-compatible history, and are idempotent", async () => {
    const first = await applyMigrations(url("m1.db"));
    expect(first.applied).toEqual(listMigrations().map((m) => m.name));
    expect(first.applied.length).toBeGreaterThanOrEqual(6);
    const second = await applyMigrations(url("m1.db"));
    expect([second.applied.length, second.alreadyApplied.length]).toEqual([0, first.applied.length]);
    const c = createClient({ url: url("m1.db") });
    const history = await c.execute(`SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`);
    expect(Number(history.rows[0].n)).toBe(first.applied.length);
    // Change-feed triggers are live: a write is logged
    await c.execute(`INSERT INTO "ledger_accounts" ("id","code","name","kind","updatedAt") VALUES ('a1','X','x','GL',CURRENT_TIMESTAMP)`);
    const log = await c.execute(`SELECT tbl, rowId, op FROM change_log ORDER BY seq DESC LIMIT 1`);
    expect([log.rows[0].tbl, log.rows[0].rowId, log.rows[0].op]).toEqual(["ledger_accounts", "a1", "I"]);
    c.close();
  });

  it("refuses to continue when an already-applied migration file was changed", async () => {
    const copy = path.join(dir, "migrations-copy");
    fs.cpSync(MIGRATIONS_DIR, copy, { recursive: true });
    await applyMigrations(url("m2.db"), { dir: copy });
    const first = listMigrations(copy)[0].name;
    fs.appendFileSync(path.join(copy, first, "migration.sql"), "\n-- edited\n");
    await expect(applyMigrations(url("m2.db"), { dir: copy })).rejects.toThrow(/changed after it was applied/);
  });

  it("a migration file checked out with Windows line endings is not a change (git core.autocrlf)", async () => {
    const copy = path.join(dir, "migrations-crlf");
    fs.cpSync(MIGRATIONS_DIR, copy, { recursive: true });
    const rewrite = (fn: (text: string) => string) => {
      for (const m of listMigrations(copy)) {
        const f = path.join(copy, m.name, "migration.sql");
        fs.writeFileSync(f, fn(fs.readFileSync(f, "utf8")));
      }
    };
    rewrite((t) => t.replace(/\r\n/g, "\n"));
    await applyMigrations(url("m3.db"), { dir: copy });
    rewrite((t) => t.replace(/\n/g, "\r\n"));
    const again = await applyMigrations(url("m3.db"), { dir: copy });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied.length).toBe(listMigrations(copy).length);
  });

  it("encrypted databases migrate and cannot be opened without the key", async () => {
    await applyMigrations(url("enc.db"), { encryptionKey: "device-key-".padEnd(32, "x") });
    const header = fs.readFileSync(path.join(dir, "enc.db")).subarray(0, 15).toString("latin1");
    expect(header).not.toBe("SQLite format 3");
    const noKey = createClient({ url: url("enc.db") });
    await expect(noKey.execute("SELECT count(*) FROM users")).rejects.toThrow();
    noKey.close();
  });
});

describe("database-per-tenant isolation", () => {
  let mod: typeof import("../prisma");
  let ctx: typeof import("./context");
  let reg: typeof import("./registry");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.CRM_TENANCY = "multi";
    process.env.CRM_NODE_ROLE = "cloud";
    process.env.CONTROL_DATABASE_URL = url("control.db");
    process.env.TENANT_DB_DIR = path.join(dir, "tenants");
    vi.resetModules();
    reg = await import("./registry");
    ctx = await import("./context");
    mod = await import("../prisma");
    for (const slug of ["alpha-traders", "beta-paper"]) {
      const t = await reg.registerTenant({ slug, name: slug });
      await applyMigrations(t.dbUrl);
      ids[slug] = t.id;
    }
  });

  it("the same code reaches only the current tenant's database", async () => {
    const { prisma } = mod;
    await ctx.runWithTenant(ids["alpha-traders"], async () => {
      await prisma.user.create({ data: { name: "A owner", email: "owner@alpha.test", password: "hash", role: "ADMIN" } });
      await prisma.ledgerAccount.create({ data: { code: "C1", name: "Alpha customer", kind: "PARTY" } });
    });
    await ctx.runWithTenant(ids["beta-paper"], async () => {
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.ledgerAccount.findUnique({ where: { code: "C1" } })).toBeNull();
      // Same email may exist in another business without colliding
      await prisma.user.create({ data: { name: "B owner", email: "owner@alpha.test", password: "hash", role: "ADMIN" } });
    });
    await ctx.runWithTenant(ids["alpha-traders"], async () => {
      expect(await prisma.user.count()).toBe(1);
      expect((await prisma.user.findFirstOrThrow()).name).toBe("A owner");
    });
  });

  it("transactions run inside the tenant's own database", async () => {
    const { prisma } = mod;
    await ctx.runWithTenant(ids["beta-paper"], () =>
      prisma.$transaction(async (tx) => {
        await tx.ledgerAccount.create({ data: { code: "C9", name: "Beta customer", kind: "PARTY" } });
      }));
    await ctx.runWithTenant(ids["alpha-traders"], async () => {
      expect(await prisma.ledgerAccount.count({ where: { code: "C9" } })).toBe(0);
    });
  });

  it("fails closed without a tenant, for unknown tenants, and for suspended tenants (data kept)", async () => {
    const { prisma } = mod;
    await expect(prisma.user.count()).rejects.toThrow(/tenant/i);
    await expect(ctx.runWithTenant("t_unknown", () => prisma.user.count())).rejects.toThrow(/Unknown tenant/);
    const gamma = await reg.registerTenant({ slug: "gamma", name: "Gamma" });
    await applyMigrations(gamma.dbUrl);
    await reg.setTenantStatus(gamma.id, "SUSPENDED");
    await expect(ctx.runWithTenant(gamma.id, () => prisma.user.count())).rejects.toThrow(/not active/);
    expect(fs.existsSync(gamma.dbUrl.replace(/^file:/, ""))).toBe(true);
    await expect(reg.registerTenant({ slug: "alpha-traders", name: "dup" })).rejects.toThrow();
  });

  it("session tokens carry a verifiable tenant id", async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-".padEnd(48, "z");
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({ userId: "u", tenantId: ids["beta-paper"] }).setProtectedHeader({ alg: "HS256" }).sign(key);
    expect(await ctx.tenantFromToken(token)).toBe(ids["beta-paper"]);
    const forged = await new SignJWT({ userId: "u", tenantId: ids["alpha-traders"] }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("wrong-secret-".padEnd(48, "q")));
    expect(await ctx.tenantFromToken(forged)).toBeNull();
  });
});
