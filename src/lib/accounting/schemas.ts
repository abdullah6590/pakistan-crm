// src/lib/accounting/schemas.ts - Request validation for the accounting API. Amounts and quantities are
// accepted as numbers or decimal strings and parsed exactly by the posting service.
import { z } from "zod";
import { STOCK_ISSUE_REASONS, PRESS_LOSS_REASONS } from "./setup";
import { VOUCHER_SERIES, CHARGE_KINDS } from "./posting";

const decimal = z.union([z.number().finite(), z.string().trim().regex(/^\d*\.?\d+$/, "Enter a number")]);
const optionalDecimal = z.union([decimal, z.literal("")]).optional();
const date = z.union([z.string().min(1, "Date is required"), z.date()]);
const optionalDate = z.union([z.string(), z.date(), z.null()]).optional();
const id = z.string().min(1);

const line = z.object({
  componentId: id,
  quantity: decimal,
  unit: z.string().min(1).optional(),
  loose: optionalDecimal,
  unitPrice: optionalDecimal,
  description: z.string().max(200).optional(),
});

const lines = z.array(line).min(1, "Add at least one line").max(200);

// Charges are recorded only; posting them is a separate explicit action (2026-10-22 rule)
export const chargeSchema = z.object({
  kind: z.enum(CHARGE_KINDS),
  amount: decimal,
  description: z.string().trim().min(1, "Describe the charge").max(200),
  date: date.optional(),
  partyAccountId: id.optional(),
  reference: z.string().max(100).optional(),
});
const charges = z.array(chargeSchema).max(20).optional();

const returnLines = z.array(z.object({ lineNo: z.number().int().positive(), quantity: decimal, unit: z.string().min(1).optional(), loose: optionalDecimal })).min(1, "Return at least one line").max(200);

export const DOCUMENT_SCHEMAS = {
  SALE_INVOICE: z.object({ date, partyAccountId: id, lines, remarks: z.string().max(500).optional() }),
  CASH_SALE: z.object({
    date, cashAccountId: id, amountReceived: optionalDecimal, partyAccountId: id.optional(),
    customerName: z.string().max(100).optional(), lines, remarks: z.string().max(500).optional(),
  }),
  PURCHASE_INVOICE: z.object({
    date, partyAccountId: id, lines, vendorBillNo: z.string().max(50).optional(), vendorBillDate: optionalDate,
    biltyNo: z.string().max(50).optional(), biltyDate: optionalDate, remarks: z.string().max(500).optional(), charges,
  }),
  STOCK_ISSUE: z.object({ date, reason: z.enum(STOCK_ISSUE_REASONS), counterAccountId: id.optional(), lines, remarks: z.string().min(1, "Explain why the stock is issued").max(500) }),
  PRESS_DISPATCH: z.object({ date, pressAccountId: id, lines, remarks: z.string().max(500).optional() }),
  PRESS_RETURN: z.object({ date, pressAccountId: id, lines, remarks: z.string().max(500).optional() }),
  PRESS_RECEIPT: z.object({
    date, pressAccountId: id, remarks: z.string().max(500).optional(), charges,
    lines: z.array(line.extend({
      consumedComponentId: id, consumedQuantity: decimal, consumedUnit: z.string().min(1).optional(),
      consumedLoose: optionalDecimal,
    })).min(1).max(200),
  }),
  PRESS_LOSS: z.object({ date, pressAccountId: id, reason: z.enum(PRESS_LOSS_REASONS), lines, remarks: z.string().min(1, "Explain the waste, damage or difference").max(500) }),
  SALE_RETURN: z.object({ date, originalDocumentId: id, refundAccountId: id.optional(), lines: returnLines, remarks: z.string().max(500).optional() }),
  PURCHASE_RETURN: z.object({ date, originalDocumentId: id, lines: returnLines, remarks: z.string().max(500).optional() }),
  STOCK_ADJUSTMENT: z.object({ date, lines, remarks: z.string().min(1, "Explain the count (who counted, when)").max(500) }),
  VOUCHER: z.object({ series: z.enum(VOUCHER_SERIES), date, debitAccountId: id, creditAccountId: id, amount: decimal, remarks: z.string().max(500).optional() }),
  TRANSFER: z.object({ date, fromAccountId: id, toAccountId: id, amount: decimal, remarks: z.string().max(500).optional() }),
  OPENING_BALANCE: z.object({ date, accountId: id, debit: optionalDecimal, credit: optionalDecimal, remarks: z.string().max(500).optional() }),
} as const;

export type DocumentType = keyof typeof DOCUMENT_SCHEMAS;

export const ledgerAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  kind: z.enum(["PARTY", "CASH_BANK", "GL"]),
  subType: z.string().max(30).optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(200).optional(),
});

export const unitProfileSchema = z.object({
  kind: z.enum(["PAPER", "PIECE", "WEIGHT", "ROLL", "SERVICE"]),
  baseUnit: z.string().trim().min(1).max(20),
  baseDecimals: z.number().int().min(0).max(3),
  purchaseUnit: z.string().max(20).nullable().optional(),
  saleUnit: z.string().max(20).nullable().optional(),
  confirmed: z.boolean(),
  referencePurchasePrice: z.union([decimal, z.null()]).optional(),
  referenceExpenses: z.union([decimal, z.null()]).optional(),
  conversions: z.array(z.object({ code: z.string().trim().min(1).max(20), factor: decimal, decimals: z.number().int().min(0).max(3).optional() })).max(10),
});

export const documentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), overrideReason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("printed") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1, "A reason is required").max(500) }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1, "A reason is required").max(500) }),
  z.object({ action: z.literal("amend"), reason: z.string().trim().min(1, "A reason is required").max(500), input: z.unknown() }),
]);

export const standaloneChargeSchema = chargeSchema.extend({ date, documentId: id.optional() });

export const chargeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("post"),
    settlement: z.enum(["PAID", "PAYABLE"]),
    expenseAccountId: id.optional(),
    cashAccountId: id.optional(),
    payeeAccountId: id.optional(),
    date: date.optional(),
  }),
  z.object({ action: z.literal("reverse"), reason: z.string().trim().min(1, "A reason is required").max(500) }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1, "A reason is required").max(500) }),
  z.object({
    action: z.literal("edit"),
    reason: z.string().trim().min(1, "A reason is required").max(500),
    patch: chargeSchema.partial().extend({ partyAccountId: z.string().optional() }),
  }),
]);
