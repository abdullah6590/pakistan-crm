// Decision D-4: database reset only for a deliberately named, confirmed, disposable development database.
import { describe, expect, it } from "vitest";
import { assertDisposableDatabase } from "./reset-guard";

describe("database reset guard (D-4)", () => {
  const ok = { CRM_CONFIRM_RESET: "demo.scratch.db" };
  it("refuses production, multi-business servers, real databases, backups and unconfirmed targets", () => {
    expect(() => assertDisposableDatabase("file:./demo.scratch.db", { ...ok, NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertDisposableDatabase("file:./demo.scratch.db", { ...ok, CRM_TENANCY: "multi" })).toThrow(/multi-business/);
    for (const real of ["crm.db", "dev.db", "test.db", "prod.db", "crm.db.scratch"]) {
      expect(() => assertDisposableDatabase(`file:./${real}`, { CRM_CONFIRM_RESET: real })).toThrow(/disposable/);
    }
    expect(() => assertDisposableDatabase("file:./backups/x.scratch.db", { CRM_CONFIRM_RESET: "x.scratch.db" })).toThrow(/backups/);
    expect(() => assertDisposableDatabase("libsql://remote.example/db", ok)).toThrow(/local file/);
    expect(() => assertDisposableDatabase(undefined, ok)).toThrow(/DATABASE_URL/);
    expect(() => assertDisposableDatabase("file:./demo.scratch.db", {})).toThrow(/CRM_CONFIRM_RESET=demo.scratch.db/);
  });
  it("allows a confirmed disposable development database", () => {
    expect(assertDisposableDatabase("file:./demo.scratch.db", ok)).toMatch(/demo\.scratch\.db$/);
  });
});
