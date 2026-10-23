// src/lib/permissions.ts - Central server-side permission matrix (audit SEC-05/SEC-06)
import { NextResponse } from "next/server";
import { getAuthUser } from "./auth";
import { isAuthority, OFFLINE_ONLY_MESSAGE } from "./sync/local";

export type Role = "ADMIN" | "PARTNER" | "EMPLOYEE" | "INVENTORY_MANAGER" | "ACCOUNTANT";
export type Action = "read" | "write" | "delete";

const ALL: Role[] = ["ADMIN", "PARTNER", "EMPLOYEE", "INVENTORY_MANAGER", "ACCOUNTANT"];

// Mirrors the page restrictions in src/proxy.ts and the sidebar roles in src/lib/constants.ts.
// "write" covers create/update; "delete" covers deletion/cancellation of posted records.
export const PERMISSIONS: Record<string, Record<Action, Role[]>> = {
  users: { read: ["ADMIN"], write: ["ADMIN"], delete: ["ADMIN"] },
  backup: { read: ["ADMIN"], write: ["ADMIN"], delete: ["ADMIN"] },
  partners: { read: ["ADMIN", "PARTNER"], write: ["ADMIN"], delete: ["ADMIN"] },
  finance: { read: ["ADMIN", "ACCOUNTANT", "PARTNER"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN"] },
  reports: { read: ["ADMIN", "ACCOUNTANT", "PARTNER"], write: [], delete: [] },
  daybook: { read: ["ADMIN", "ACCOUNTANT", "PARTNER"], write: [], delete: [] },
  accounts: { read: ["ADMIN", "ACCOUNTANT"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN", "ACCOUNTANT"] },
  transfers: { read: ["ADMIN", "ACCOUNTANT"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN"] },
  expenditures: { read: ["ADMIN", "ACCOUNTANT"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN", "ACCOUNTANT"] },
  inventory: { read: ALL, write: ["ADMIN", "INVENTORY_MANAGER"], delete: ["ADMIN", "INVENTORY_MANAGER"] },
  purchases: { read: ["ADMIN", "INVENTORY_MANAGER", "ACCOUNTANT"], write: ["ADMIN", "INVENTORY_MANAGER"], delete: ["ADMIN"] },
  suppliers: { read: ["ADMIN", "INVENTORY_MANAGER", "ACCOUNTANT"], write: ["ADMIN", "INVENTORY_MANAGER"], delete: ["ADMIN"] },
  supplierPayments: { read: ["ADMIN", "ACCOUNTANT", "INVENTORY_MANAGER"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN"] },
  sales: { read: ["ADMIN", "EMPLOYEE", "ACCOUNTANT", "PARTNER"], write: ["ADMIN", "EMPLOYEE", "ACCOUNTANT"], delete: ["ADMIN"] },
  cashSales: { read: ["ADMIN", "EMPLOYEE", "ACCOUNTANT"], write: ["ADMIN", "EMPLOYEE"], delete: ["ADMIN"] },
  customers: { read: ["ADMIN", "EMPLOYEE", "ACCOUNTANT", "PARTNER"], write: ["ADMIN", "EMPLOYEE"], delete: ["ADMIN"] },
  customerPayments: { read: ["ADMIN", "ACCOUNTANT", "EMPLOYEE"], write: ["ADMIN", "ACCOUNTANT", "EMPLOYEE"], delete: ["ADMIN"] },
  // Same roles as the earlier canManageProjects helper (audit R-SEC-1)
  projects: { read: ["ADMIN", "EMPLOYEE", "PARTNER"], write: ["ADMIN", "EMPLOYEE", "PARTNER"], delete: ["ADMIN"] },
  // Every role may open the dashboard; each section is filtered by its own module permission
  dashboard: { read: ALL, write: [], delete: [] },
  // Accounting core (Report 15 build order). Stock issues are drafted by stock roles and only an
  // administrator may approve them into posted stock (owner instruction 4).
  stockIssues: { read: ["ADMIN", "INVENTORY_MANAGER", "ACCOUNTANT"], write: ["ADMIN", "INVENTORY_MANAGER"], delete: ["ADMIN"] },
  stockApproval: { read: ["ADMIN", "INVENTORY_MANAGER", "ACCOUNTANT"], write: ["ADMIN"], delete: [] },
  press: { read: ["ADMIN", "INVENTORY_MANAGER", "ACCOUNTANT"], write: ["ADMIN", "INVENTORY_MANAGER"], delete: ["ADMIN"] },
  vouchers: { read: ["ADMIN", "ACCOUNTANT", "PARTNER"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN"] },
  ledgers: { read: ["ADMIN", "ACCOUNTANT", "PARTNER"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN"] },
  accountingSettings: { read: ["ADMIN", "ACCOUNTANT"], write: ["ADMIN"], delete: [] },
  // Charges (2026-10-22): stock and accounts staff record them; only accounts staff post them as expenses,
  // and reversing a posting is an administrator action
  charges: { read: ["ADMIN", "ACCOUNTANT", "INVENTORY_MANAGER", "PARTNER"], write: ["ADMIN", "ACCOUNTANT", "INVENTORY_MANAGER"], delete: ["ADMIN", "ACCOUNTANT"] },
  chargePosting: { read: ["ADMIN", "ACCOUNTANT", "PARTNER"], write: ["ADMIN", "ACCOUNTANT"], delete: ["ADMIN"] },
  // Offline sync (Report 21): everyone sees their computer's status; administrators register and revoke computers
  sync: { read: ALL, write: ["ADMIN"], delete: ["ADMIN"] },
  // Local encrypted backups and restore on this computer (Reports 22, 23): administrators only
  backupLocal: { read: ["ADMIN"], write: ["ADMIN"], delete: ["ADMIN"] },
};

/** Resource that governs each accounting document type (create = write, cancel/amend = delete). */
export const DOCUMENT_RESOURCE: Record<string, string> = {
  PURCHASE_INVOICE: "purchases",
  SALE_INVOICE: "sales",
  CASH_SALE: "cashSales",
  STOCK_ISSUE: "stockIssues",
  PRESS_DISPATCH: "press",
  PRESS_RECEIPT: "press",
  PRESS_RETURN: "press",
  PRESS_LOSS: "press",
  VOUCHER: "vouchers",
  TRANSFER: "transfers",
  OPENING_BALANCE: "ledgers",
  CHARGE_EXPENSE: "chargePosting",
  SALE_RETURN: "sales",
  PURCHASE_RETURN: "purchases",
  STOCK_ADJUSTMENT: "stockIssues",
};

/** Which dashboard sections a role may see; data for hidden sections is never queried or sent. */
export function dashboardVisibility(role: string) {
  return {
    finance: can(role, "finance", "read"),
    sales: can(role, "sales", "read"),
    purchases: can(role, "purchases", "read"),
    projects: can(role, "projects", "read"),
    partners: can(role, "partners", "read"),
  };
}

// Modules served by /dashboard/print and /dashboard/analysis, mapped to the resource they expose.
export const MODULE_RESOURCE: Record<string, string> = {
  sales: "sales",
  purchases: "purchases",
  inventory: "inventory",
  customers: "customers",
  suppliers: "suppliers",
  finance: "finance",
  expenditures: "expenditures",
  accounts: "accounts",
};

export function can(role: string, resource: string, action: Action): boolean {
  const rule = PERMISSIONS[resource];
  if (!rule) return false;
  return rule[action].includes(role as Role);
}

type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuthUser>>>;

export async function authorize(
  resource: string,
  action: Action,
  opts: { offlineCapable?: boolean } = {}
): Promise<{ user: AuthUser; response: null } | { user: null; response: NextResponse }> {
  const user = await getAuthUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(user.role, resource, action)) {
    return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  // On a device or hub the local database is a replica of the cloud: direct changes would diverge from it.
  // Only routes that queue a sync command (offlineCapable) may write there (Report 21 §2).
  if (action !== "read" && !opts.offlineCapable && !isAuthority()) {
    return { user: null, response: NextResponse.json({ error: OFFLINE_ONLY_MESSAGE }, { status: 503 }) };
  }
  return { user, response: null };
}
