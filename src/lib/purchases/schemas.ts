// src/lib/purchases/schemas.ts - What the Purchases and Suppliers screens send (Report 30).
import { z } from "zod";
import { CHARGE_KINDS } from "@/lib/accounting/posting";

const amount = z.union([z.number(), z.string().trim().min(1)]);
const requestId = z.string().uuid().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-29");
const text = (max: number) => z.string().max(max).nullish();

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name").max(120),
  company: text(120), contactPerson: text(120), email: z.string().trim().email("Enter a valid e-mail").max(120).or(z.literal("")).nullish(),
  phone: text(40), address: text(300), city: text(60), country: text(60), taxNumber: text(60), notes: text(1000),
  customFields: z.array(z.object({ label: z.string().max(60), value: z.string().max(500) })).max(30).optional(),
  confirmNotDuplicate: z.string().max(300).optional(),
});
export const supplierUpdateSchema = supplierSchema.partial();

export const archiveSchema = z.object({ active: z.boolean(), reason: z.string().trim().min(3, "Give a reason").max(500) });

export const openingBalanceSchema = z.object({
  date: day, owed: amount.optional(), advance: amount.optional(), reason: z.string().trim().min(10, "Explain where the opening balance comes from (at least 10 characters)").max(500), requestId,
});

const line = z.object({
  componentId: z.string().min(1), quantity: amount, unit: z.string().trim().min(1).max(20).optional(), loose: amount.optional(), unitPrice: amount,
});

export const screenPurchaseSchema = z.object({
  date: day.optional(),
  supplierId: z.string().min(1, "Choose the supplier"),
  vendorBillNo: text(60),
  vendorBillDate: day.nullish().or(z.literal("")),
  dueDate: day.nullish().or(z.literal("")),
  biltyNo: text(60),
  biltyDate: day.nullish().or(z.literal("")),
  items: z.array(line).min(1, "Add at least one item").max(200),
  charges: z.array(z.object({ kind: z.enum(CHARGE_KINDS), amount, description: z.string().trim().min(1, "Describe the charge").max(200), reference: z.string().max(60).optional() })).max(20).optional(),
  notes: text(1000),
  paidNow: z.object({ amount, method: z.string().min(1), cashAccountId: z.string().optional(), reference: z.string().max(80).optional() }).nullish(),
  requestId,
});

export const amendPurchaseSchema = screenPurchaseSchema.omit({ charges: true, paidNow: true }).extend({
  reason: z.string().trim().min(3, "Give a reason for the change").max(500),
});

export const paySupplierSchema = z.object({
  supplierId: z.string().min(1),
  date: day,
  amount,
  method: z.string().min(1),
  cashAccountId: z.string().optional(),
  reference: z.string().max(80).optional(),
  allocations: z.array(z.object({ billId: z.string().min(1), amount })).max(100).default([]),
  remarks: z.string().max(500).optional(),
  requestId,
});

export const applySupplierCreditSchema = z.object({ sourceId: z.string().min(1), billId: z.string().min(1), amount, requestId });

export const supplierRefundSchema = z.object({
  supplierId: z.string().min(1),
  date: day,
  amount,
  method: z.string().min(1),
  cashAccountId: z.string().optional(),
  reference: z.string().max(80).optional(),
  remarks: z.string().max(500).optional(),
  requestId,
});

export const purchaseReturnSchema = z.object({
  date: day,
  lines: z.array(z.object({ lineNo: z.number().int().positive(), quantity: amount, unit: z.string().min(1).max(20).optional(), loose: amount.optional() })).min(1, "Choose what is returned"),
  remarks: z.string().trim().min(3, "Say why the goods go back").max(500),
  requestId,
});

export const cancelSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });
