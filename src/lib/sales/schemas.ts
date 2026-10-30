// src/lib/sales/schemas.ts - What the Sales screens send (Report 28).
import { z } from "zod";

const amount = z.union([z.number(), z.string()]);
const requestId = z.string().uuid().optional();

export const screenSaleSchema = z.object({
  date: z.string().optional(),
  customerId: z.string().nullish(),
  walkInName: z.string().max(120).nullish(),
  items: z.array(z.object({
    componentId: z.string().min(1), quantity: amount, unit: z.string().trim().min(1).max(20).optional(), loose: amount.optional(), unitPrice: amount,
  })).min(1, "Add at least one item"),
  notes: z.string().max(1000).nullish(),
  paidNow: z.object({ amount, method: z.string().min(1), cashAccountId: z.string().optional() }).nullish(),
  requestId,
});

export const amendSaleSchema = screenSaleSchema.extend({ reason: z.string().trim().min(3, "Give a reason for the change").max(500) });

export const receivePaymentSchema = z.object({
  customerId: z.string().min(1),
  date: z.string().min(1),
  amount,
  method: z.string().min(1),
  cashAccountId: z.string().optional(),
  allocations: z.array(z.object({ invoiceId: z.string().min(1), amount })).default([]),
  remarks: z.string().max(500).optional(),
  requestId,
});

export const applyCreditSchema = z.object({ receiptId: z.string().min(1), invoiceId: z.string().min(1), amount, requestId });

export const refundSchema = z.object({
  customerId: z.string().min(1),
  date: z.string().min(1),
  amount,
  method: z.string().min(1),
  cashAccountId: z.string().optional(),
  remarks: z.string().max(500).optional(),
  requestId,
});

export const cancelSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });
