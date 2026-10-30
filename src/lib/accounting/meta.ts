// src/lib/accounting/meta.ts - Client-safe document metadata and number formatting for the accounting screens.
import { dec, toFixed, isZero } from "@/lib/domain/decimal";

export interface DocumentTypeMeta {
  title: string;
  plural: string;
  /** "items" documents have item lines; "money" documents move an amount between accounts. */
  form: "items" | "money" | "return";
  priced?: boolean;
  /** Which party account the document names, if any. */
  party?: "customer" | "supplier" | "press";
  approval?: boolean;
  description: string;
}

export const DOCUMENT_TYPES: Record<string, DocumentTypeMeta> = {
  SALE_INVOICE: { title: "Sale invoice", plural: "Sale invoices", form: "items", priced: true, party: "customer", description: "Credit sale to a customer; stock out at cost, customer charged the rounded total." },
  CASH_SALE: { title: "Cash sale", plural: "Cash sales", form: "items", priced: true, description: "Counter sale paid in cash or bank; any unpaid remainder is charged to the customer or Counter Sale." },
  PURCHASE_INVOICE: { title: "Purchase invoice", plural: "Purchase invoices", form: "items", priced: true, party: "supplier", description: "Goods received from a supplier at cost; supplier credited." },
  STOCK_ISSUE: { title: "Stock issue", plural: "Stock issues", form: "items", approval: true, description: "Stock used or written off without a sale. Waits for administrator approval before stock moves." },
  PRESS_DISPATCH: { title: "Send to press", plural: "Material sent to press", form: "items", party: "press", description: "Material sent for printing stays your stock, held at the press. The press is not charged." },
  PRESS_RECEIPT: { title: "Receive from press", plural: "Printed goods received", form: "items", party: "press", description: "Printed goods received; records the material used and any printing charge billed by the press." },
  PRESS_RETURN: { title: "Return from press", plural: "Unused material returned", form: "items", party: "press", description: "Unused material brought back from the press to the store." },
  PRESS_LOSS: { title: "Press loss", plural: "Press waste and differences", form: "items", party: "press", approval: true, description: "Waste, damage or an unexplained difference at the press. Waits for administrator approval." },
  SALE_RETURN: { title: "Sale return", plural: "Sale returns", form: "return", priced: true, description: "Goods returned by a customer against a sale invoice or cash sale; stock comes back at its original cost." },
  PURCHASE_RETURN: { title: "Purchase return", plural: "Purchase returns", form: "return", priced: true, party: "supplier", description: "Goods sent back to a supplier against a purchase invoice; the supplier is debited." },
  STOCK_ADJUSTMENT: { title: "Stock count", plural: "Stock counts", form: "items", approval: true, description: "Counted quantities in the store. Differences post only after administrator approval." },
  VOUCHER: { title: "Voucher", plural: "Vouchers", form: "money", description: "Cash/bank receipts (CRV/BRV), payments (CPV/BPV) and journal vouchers (JV)." },
  TRANSFER: { title: "Transfer", plural: "Transfers", form: "money", description: "Move money between cash and bank accounts." },
  CHARGE_EXPENSE: { title: "Charge posted as expense", plural: "Charges posted as expenses", form: "money", description: "Created only by \"Post as expense\" on a recorded charge; reversed from the charge." },
  OPENING_STOCK: { title: "Opening stock", plural: "Opening stock", form: "items", description: "Stock already on hand when Books started, at cost (Report 28). Posts no income." },
  OPENING_BALANCE: { title: "Opening balance", plural: "Opening balances", form: "money", description: "Balance brought forward for an account." },
};

export const STATUS_LABEL: Record<string, string> = {
  POSTED: "Posted",
  PENDING_APPROVAL: "Waiting for approval",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  DRAFT: "Draft",
};

export const REASON_LABEL: Record<string, string> = {
  INTERNAL_CONSUMPTION: "Internal consumption",
  DAMAGE: "Damage",
  SAMPLE: "Sample",
  OTHER: "Other",
  WASTE: "Waste",
  UNEXPLAINED_DIFFERENCE: "Unexplained difference",
};

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Money with thousands separators; "-" for zero (Report 14 §1). */
export function money(value: string | null | undefined, dp = 2): string {
  if (value === null || value === undefined || value === "") return "-";
  const d = dec(value);
  if (isZero(d)) return "-";
  const [i, f] = toFixed(d, dp).split(".");
  const neg = i.startsWith("-");
  const body = group(neg ? i.slice(1) : i) + (f ? `.${f}` : "");
  return neg ? `(${body})` : body;
}

/** Quantity without trailing zeros, "-" for zero. */
export function qty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const d = dec(value);
  if (isZero(d)) return "-";
  const [i, f] = toFixed(d, 3).replace(/\.?0+$/, "").split(".");
  return group(i) + (f ? `.${f}` : "");
}

/** Signed balance shown as amount + Dr/Cr. */
export function drCr(value: string | null | undefined, dp = 2): string {
  if (value === null || value === undefined) return "-";
  const d = dec(value);
  if (isZero(d)) return "0";
  return `${money(d < BigInt(0) ? value.replace(/^-/, "") : value, dp)} ${d < BigInt(0) ? "Cr" : "Dr"}`;
}

export function formatDate(value: Date | string | null | undefined, format = "DD/MM/YYYY"): string {
  if (!value) return "-";
  const d = new Date(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return format === "MM/DD/YYYY" ? `${mm}/${dd}/${d.getFullYear()}` : `${dd}/${mm}/${d.getFullYear()}`;
}

/** Print date in the legacy header style d-MMM-yy (Report 14 §1). */
export function printDate(value: Date = new Date()): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][value.getMonth()];
  return `${value.getDate()}-${m}-${String(value.getFullYear()).slice(2)}`;
}
