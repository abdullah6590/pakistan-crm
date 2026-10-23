// src/lib/accounting/setup.ts - System accounts, stock locations and accounting settings.
import type { PrismaClient, Prisma } from "@prisma/client";
import { NegativeStockPolicy } from "@/lib/domain/stock";

export type Db = PrismaClient | Prisma.TransactionClient;

/** Accounts the posting rules (src/lib/domain/ledger.ts) refer to by code. */
export const SYSTEM_ACCOUNTS = [
  { code: "SALES_REVENUE", name: "Sales", kind: "GL", subType: "INCOME" },
  { code: "SALES_RETURNS", name: "Sales returns", kind: "GL", subType: "INCOME" },
  { code: "STOCK_GAIN", name: "Stock count gains", kind: "GL", subType: "INCOME" },
  { code: "INVENTORY", name: "Stock in hand", kind: "GL", subType: "ASSET" },
  { code: "COST_OF_GOODS_SOLD", name: "Cost of goods sold", kind: "GL", subType: "EXPENSE" },
  { code: "ROUNDING_ADJUSTMENT", name: "Rounding adjustment", kind: "GL", subType: "EXPENSE" },
  { code: "OPENING_BALANCE_EQUITY", name: "Opening balances", kind: "GL", subType: "EQUITY" },
  { code: "INTERNAL_CONSUMPTION", name: "Internal consumption", kind: "GL", subType: "EXPENSE" },
  { code: "STOCK_LOSS", name: "Stock loss and damage", kind: "GL", subType: "EXPENSE" },
  // Expense accounts offered when a recorded charge is explicitly posted (2026-10-22 rule)
  { code: "FREIGHT_EXPENSE", name: "Freight and carriage", kind: "GL", subType: "EXPENSE" },
  { code: "LOADING_EXPENSE", name: "Loading and unloading", kind: "GL", subType: "EXPENSE" },
  { code: "BILTY_EXPENSE", name: "Bilty (transport receipt) charges", kind: "GL", subType: "EXPENSE" },
  { code: "PRINTING_EXPENSE", name: "Printing charges", kind: "GL", subType: "EXPENSE" },
  // F-03: default party for the unpaid remainder of a cash sale (Report 13 D-D)
  { code: "COUNTER_SALE", name: "Counter Sale", kind: "PARTY", subType: "CUSTOMER" },
] as const;

export const MAIN_LOCATION = "MAIN";

export const STOCK_ISSUE_REASONS = ["INTERNAL_CONSUMPTION", "DAMAGE", "SAMPLE", "OTHER"] as const;
export const PRESS_LOSS_REASONS = ["WASTE", "DAMAGE", "UNEXPLAINED_DIFFERENCE"] as const;

export const SETTING_DEFAULTS = {
  NEGATIVE_STOCK_POLICY: "ALLOW_WITH_WARNING" as NegativeStockPolicy, // OD-04
  STOCK_ISSUE_APPROVAL: "REQUIRED", // owner instruction 4: no monetary threshold
  COUNTER_SALE_ACCOUNT: "COUNTER_SALE",
  ISSUE_ACCOUNT_INTERNAL_CONSUMPTION: "INTERNAL_CONSUMPTION",
  ISSUE_ACCOUNT_DAMAGE: "STOCK_LOSS",
  ISSUE_ACCOUNT_SAMPLE: "INTERNAL_CONSUMPTION",
  ISSUE_ACCOUNT_OTHER: "STOCK_LOSS",
  PRESS_LOSS_ACCOUNT: "STOCK_LOSS",
  // Print header and row dates (Report 14 §1); the owner fills in the business details
  BUSINESS_NAME: "",
  BUSINESS_ADDRESS: "",
  DATE_FORMAT: "DD/MM/YYYY",
  // Separation of duties for stock issues: empty = nobody may approve their own issue. Set only to the
  // verified owner's user id; that user may then self-approve with a written reason (audited).
  SELF_APPROVAL_OVERRIDE_USER: "",
  // Post-as-expense defaults for recorded charges (2026-10-22 rule); the user may choose another expense account
  CHARGE_EXPENSE_FREIGHT: "FREIGHT_EXPENSE",
  CHARGE_EXPENSE_LOADING: "LOADING_EXPENSE",
  CHARGE_EXPENSE_BILTY: "BILTY_EXPENSE",
  CHARGE_EXPENSE_OTHER_PURCHASE: "FREIGHT_EXPENSE",
  CHARGE_EXPENSE_PRINTING: "PRINTING_EXPENSE",
};

const TEXT_SETTINGS: SettingKey[] = ["BUSINESS_NAME", "BUSINESS_ADDRESS"];

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function ensureAccountingSetup(db: Db): Promise<void> {
  for (const a of SYSTEM_ACCOUNTS) {
    await db.ledgerAccount.upsert({
      where: { code: a.code },
      create: { code: a.code, name: a.name, kind: a.kind, subType: a.subType, isSystem: true },
      update: {},
    });
  }
  await db.stockLocation.upsert({
    where: { code: MAIN_LOCATION },
    create: { code: MAIN_LOCATION, name: "Main store", kind: "STORE" },
    update: {},
  });
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const row = await db.accountingSetting.findUnique({ where: { key } });
  return (row?.value ?? SETTING_DEFAULTS[key]) as (typeof SETTING_DEFAULTS)[K];
}

const SETTING_VALUES: Partial<Record<SettingKey, readonly string[]>> = {
  NEGATIVE_STOCK_POLICY: ["ALLOW_WITH_WARNING", "ALLOW_SILENT", "BLOCK"],
  STOCK_ISSUE_APPROVAL: ["REQUIRED", "NOT_REQUIRED"],
  DATE_FORMAT: ["DD/MM/YYYY", "MM/DD/YYYY"],
};

export async function setSetting(db: Db, key: SettingKey, value: string, userId: string): Promise<void> {
  const current = await db.accountingSetting.findUnique({ where: { key } });
  if ((current?.value ?? String(SETTING_DEFAULTS[key])) === value) return; // unchanged: nothing to validate or record
  const allowed = SETTING_VALUES[key];
  if (allowed && !allowed.includes(value)) throw new Error(`${key} must be one of ${allowed.join(", ")}`);
  if (TEXT_SETTINGS.includes(key)) {
    if (value.length > 200) throw new Error(`${key} is too long`);
  } else if (key === "SELF_APPROVAL_OVERRIDE_USER") {
    if (value) {
      // An administrator cannot nominate themselves; otherwise the override would defeat separation of duties
      if (value === userId) throw new Error("Another administrator must nominate the override user");
      const user = await db.user.findUnique({ where: { id: value } });
      if (!user || !user.isActive || user.role !== "ADMIN") throw new Error("The override user must be an active administrator");
    }
  } else if (!allowed) {
    // Remaining settings name an account by code
    const account = await db.ledgerAccount.findUnique({ where: { code: value } });
    if (!account || !account.isActive) throw new Error(`${key}: account "${value}" does not exist`);
  }
  const before = await db.accountingSetting.findUnique({ where: { key } });
  await db.accountingSetting.upsert({ where: { key }, create: { key, value, updatedById: userId }, update: { value, updatedById: userId } });
  await db.auditLog.create({
    data: { entity: "AccountingSetting", entityId: key, action: "UPDATE", userId, before: before ? JSON.stringify({ value: before.value }) : null, after: JSON.stringify({ value }) },
  });
}

/**
 * Decision D-2 (2026-10-22): the own-approval override is enabled separately, by the owner or platform operator at
 * the server (scripts/approval-override.ts), never from an ordinary screen. Only an active administrator of THIS
 * business's database can hold it; every change is audited with its reason and shown in the "Own-approval
 * overrides" report.
 */
export async function setApprovalOverride(db: Db, input: { userId: string | null; changedBy: string; reason: string }) {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new Error("Give a reason of at least 10 characters");
  if (input.userId) {
    const user = await db.user.findUnique({ where: { id: input.userId } });
    if (!user || !user.isActive || user.role !== "ADMIN") throw new Error("The override can only be enabled for an active administrator of this business");
  }
  const value = input.userId ?? "";
  const before = await db.accountingSetting.findUnique({ where: { key: "SELF_APPROVAL_OVERRIDE_USER" } });
  await db.accountingSetting.upsert({
    where: { key: "SELF_APPROVAL_OVERRIDE_USER" },
    create: { key: "SELF_APPROVAL_OVERRIDE_USER", value, updatedById: input.changedBy },
    update: { value, updatedById: input.changedBy },
  });
  await db.auditLog.create({
    data: {
      entity: "AccountingSetting", entityId: "SELF_APPROVAL_OVERRIDE_USER", action: value ? "ENABLE_OVERRIDE" : "DISABLE_OVERRIDE", userId: input.changedBy, reason,
      before: before ? JSON.stringify({ value: before.value }) : null, after: JSON.stringify({ value }),
    },
  });
}
