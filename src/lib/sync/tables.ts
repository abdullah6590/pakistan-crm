// src/lib/sync/tables.ts - Tables copied to replicas, in dependency order (Report 21 §4).
// Append-only tables are only ever inserted (their database triggers forbid update and delete).
export interface ReplicatedTable {
  name: string;
  key: string;
  appendOnly?: boolean;
}

export const REPLICATED_TABLES: ReplicatedTable[] = [
  { name: "users", key: "id" },
  { name: "devices", key: "id" },
  { name: "component_categories", key: "id" },
  { name: "components", key: "id" },
  { name: "item_unit_profiles", key: "id" },
  { name: "item_unit_conversions", key: "id" },
  { name: "ledger_accounts", key: "id" },
  { name: "stock_locations", key: "id" },
  { name: "accounting_settings", key: "key" },
  { name: "document_series", key: "series" },
  { name: "accounting_documents", key: "id" },
  { name: "accounting_document_lines", key: "id" },
  { name: "charge_records", key: "id" },
  { name: "journal_entries", key: "id", appendOnly: true },
  { name: "journal_lines", key: "id", appendOnly: true },
  { name: "stock_movements", key: "id", appendOnly: true },
  { name: "item_stock_balances", key: "id" },
  { name: "item_cost_states", key: "id" },
  { name: "audit_logs", key: "id", appendOnly: true },
  { name: "number_blocks", key: "id" },
];

export const TABLE_BY_NAME = new Map(REPLICATED_TABLES.map((t) => [t.name, t]));

/** JSON-safe row values: dates and 64-bit integers keep their exact stored form. */
export type WireValue = string | number | boolean | null | { $d: string } | { $b: string };

export function encodeRow(row: Record<string, unknown>): Record<string, WireValue> {
  const out: Record<string, WireValue> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = { $d: v.toISOString() };
    else if (typeof v === "bigint") out[k] = { $b: v.toString() };
    else if (v === undefined) out[k] = null;
    else out[k] = v as WireValue;
  }
  return out;
}

/** Decode for writing to SQLite: dates in Prisma's stored form, booleans as 0/1, integers as bigint. */
export function decodeValue(v: WireValue): string | number | bigint | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object" && "$d" in v) return v.$d.replace(/Z$/, "+00:00");
  if (typeof v === "object" && "$b" in v) return BigInt(v.$b);
  return v as string | number;
}
