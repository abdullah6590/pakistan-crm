import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLASSIC_MENUS, menuForPath, visibleMenus } from "./classic-menu";
import { SHORTCUT_ACTIONS } from "./shortcuts";
import { can, PERMISSIONS } from "./permissions";
import { DOCUMENT_TYPES } from "./accounting/meta";
import { CLASSIC_ICONS } from "@/components/layout/classic-icons";

const APP = path.join(process.cwd(), "src", "app");

/** Whether an address opens a page in src/app (a [type] folder takes any document type). */
function pageExists(href: string): boolean {
  const parts = href.split(/[?#]/)[0].split("/").filter(Boolean);
  let dir = APP;
  for (const p of parts) {
    if (fs.existsSync(path.join(dir, p))) { dir = path.join(dir, p); continue; }
    // A folder like [id] stands only for the picker's placeholder "x"; [type] takes a real document type
    const dynamic = fs.readdirSync(dir).find((d) => /^\[[^\]]+\]$/.test(d));
    if (!dynamic) return false;
    if (dynamic === "[type]" ? !DOCUMENT_TYPES[p] : p !== "x") return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, "page.tsx"));
}

const items = CLASSIC_MENUS.flatMap((m) => m.items.map((i) => ({ ...i, menu: m.id })));
const forRole = (role: string) => visibleMenus((a) => can(role, a.resource, a.action));

describe("classic menu bar", () => {
  it("has the old program's tabs in its order, plus Reports", () => {
    expect(CLASSIC_MENUS.map((m) => m.label)).toEqual(["Product", "Supplier", "Customer", "Cash Sale", "Finance", "Reports", "Backup"]);
  });

  it("every item opens a page that exists, or the ledger picker; ids are unique", () => {
    for (const i of items) {
      if (i.picker) {
        expect(pageExists(`/dashboard/${i.picker}/x/ledger`), i.id).toBe(true);
        continue;
      }
      expect(i.href, i.id).toBeTruthy();
      expect(pageExists(i.href!), `${i.id} -> ${i.href}`).toBe(true);
    }
    expect(new Set(items.map((i) => `${i.menu}/${i.id}`)).size).toBe(items.length);
  });

  it("every tab and item has an icon the menu bar can draw", () => {
    for (const m of CLASSIC_MENUS) {
      expect(CLASSIC_ICONS[m.icon], m.id).toBeTruthy();
      for (const i of m.items) expect(CLASSIC_ICONS[i.icon], i.id).toBeTruthy();
    }
  });

  it("every item names a real permission and a real shortcut that opens the same page", () => {
    for (const i of items) {
      expect(PERMISSIONS[i.access.resource], `${i.id}: ${i.access.resource}`).toBeTruthy();
      if (!i.shortcut) continue;
      const action = SHORTCUT_ACTIONS.find((a) => a.id === i.shortcut);
      expect(action, `${i.id}: ${i.shortcut}`).toBeTruthy();
      expect(action!.href, i.id).toBe(i.href);
    }
  });

  it("the old program's entries carry its keys", () => {
    const key = (id: string) => SHORTCUT_ACTIONS.find((a) => a.id === items.find((i) => i.id === id)?.shortcut)?.defaultKey;
    expect(key("stock-invoice")).toBe("Ctrl+Alt+B");
    expect(key("cash-paid")).toBe("Ctrl+Alt+C");
    expect(key("customer-invoice")).toBe("Ctrl+B");
    expect(key("cash-received")).toBe("Alt+C");
  });

  it("each role sees only what it may open", () => {
    expect(forRole("ADMIN").map((m) => m.id)).toEqual(CLASSIC_MENUS.map((m) => m.id));
    const employee = forRole("EMPLOYEE");
    const ids = employee.flatMap((m) => m.items.map((i) => i.id));
    expect(ids).toContain("customer-invoice");
    expect(ids).toContain("cash-sale");
    expect(ids).not.toContain("backups");
    expect(ids).not.toContain("receipt-voucher");
    expect(employee.find((m) => m.id === "backup")).toBeUndefined();
    for (const m of forRole("INVENTORY_MANAGER")) for (const i of m.items) expect(can("INVENTORY_MANAGER", i.access.resource, i.access.action)).toBe(true);
  });

  it("marks the tab of the page being shown", () => {
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/purchases/new")).toBe("supplier");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/purchases/abc123")).toBe("supplier");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/sales/new")).toBe("customer");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/sales/new", "?walkin=1")).toBe("cash-sale");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/accounting/reports", "?report=daybook")).toBe("customer");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/accounting/reports", "?report=balance-sheet&to=2026-11-01")).toBe("reports");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/inventory/groups")).toBe("product");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard/accounting/new/VOUCHER", "?series=CPV")).toBe("finance");
    expect(menuForPath(CLASSIC_MENUS, "/dashboard")).toBeNull();
  });
});
