import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, MODULE_RESOURCE, dashboardVisibility } from "./permissions";

describe("permission matrix (audit SEC-02/03/05/06)", () => {
  it("restricts backup and users to ADMIN", () => {
    for (const role of ["PARTNER", "EMPLOYEE", "INVENTORY_MANAGER", "ACCOUNTANT"]) {
      expect(can(role, "backup", "read")).toBe(false);
      expect(can(role, "backup", "write")).toBe(false);
      expect(can(role, "users", "write")).toBe(false);
    }
    expect(can("ADMIN", "backup", "write")).toBe(true);
  });

  it("blocks the reproduced EMPLOYEE escalations (DT-SEC-04b/06/10/11, DT-BUS-03)", () => {
    expect(can("EMPLOYEE", "finance", "write")).toBe(false);
    expect(can("EMPLOYEE", "accounts", "write")).toBe(false);
    expect(can("EMPLOYEE", "transfers", "write")).toBe(false);
    expect(can("EMPLOYEE", "purchases", "write")).toBe(false);
    expect(can("EMPLOYEE", "sales", "delete")).toBe(false);
    expect(can("EMPLOYEE", "sales", "write")).toBe(true);
  });

  it("maps every print/analysis module to a resource that exists", () => {
    for (const resource of Object.values(MODULE_RESOURCE)) expect(PERMISSIONS[resource]).toBeDefined();
    expect(can("EMPLOYEE", MODULE_RESOURCE.finance, "read")).toBe(false);
  });

  it("restricts projects to the project roles and deletion to ADMIN (R-SEC-1)", () => {
    for (const role of ["ADMIN", "EMPLOYEE", "PARTNER"]) expect(can(role, "projects", "write")).toBe(true);
    for (const role of ["ACCOUNTANT", "INVENTORY_MANAGER"]) {
      expect(can(role, "projects", "read")).toBe(false);
      expect(can(role, "projects", "write")).toBe(false);
    }
    expect(can("EMPLOYEE", "projects", "delete")).toBe(false);
  });

  it("filters dashboard sections by module permission (R-SEC-1)", () => {
    expect(dashboardVisibility("INVENTORY_MANAGER")).toEqual({ finance: false, sales: false, purchases: true, projects: false, partners: false });
    expect(dashboardVisibility("EMPLOYEE")).toEqual({ finance: false, sales: true, purchases: false, projects: true, partners: false });
    expect(dashboardVisibility("ADMIN")).toEqual({ finance: true, sales: true, purchases: true, projects: true, partners: true });
    for (const role of ["ADMIN", "PARTNER", "EMPLOYEE", "INVENTORY_MANAGER", "ACCOUNTANT"]) expect(can(role, "dashboard", "read")).toBe(true);
  });

  it("denies unknown roles and resources", () => {
    expect(can("ADMIN", "nonexistent", "read")).toBe(false);
    expect(can("GUEST", "sales", "read")).toBe(false);
  });
});
