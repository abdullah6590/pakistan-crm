// src/lib/sync/commands.ts - Commands a device or hub queues for the ledger authority (Report 21 §2).
// A command describes intent ("create this sale invoice"); only the authority turns it into postings.
import crypto from "node:crypto";
import { z } from "zod";
import { DOCUMENT_SCHEMAS, standaloneChargeSchema } from "@/lib/accounting/schemas";
import { screenPurchaseSchema, paySupplierSchema } from "@/lib/purchases/schemas";
import { screenSaleSchema, receivePaymentSchema } from "@/lib/sales/schemas";

/**
 * Sync protocol version (Report 26 Phase 9 §R). Raise SYNC_PROTOCOL when the command format changes; the server keeps
 * accepting every version from MIN_SYNC_PROTOCOL up. A computer outside that range is refused before any command is
 * read, so its entries stay queued on it (never rejected for good) until the older side is updated.
 */
// 2 (Report 30): bills and payments from the Sales and Purchases screens, customers and suppliers copied to computers,
// and new document columns. A version 1 computer must be updated first; its entries wait on it until then.
export const SYNC_PROTOCOL = 2;
export const MIN_SYNC_PROTOCOL = 2;

/** Compatibility of a computer's protocol header with this server; a missing header is version 1 (Phase 3 clients). */
export function checkProtocol(header: string | null): { status: number; code: string; error: string } | null {
  const v = Number(header ?? "1");
  if (!Number.isInteger(v) || v < MIN_SYNC_PROTOCOL) return { status: 426, code: "CLIENT_TOO_OLD", error: "Update the application on this computer; its entries are kept until then" };
  if (v > SYNC_PROTOCOL) return { status: 409, code: "SERVER_TOO_OLD", error: "The server runs an older version than this computer; entries are kept until it is updated" };
  return null;
}

/** A reference to a document or charge: by its central id, or by the command that created it (offline). */
const ref = z.object({ id: z.string().min(1).optional(), commandRef: z.string().uuid().optional() })
  .refine((r) => !!r.id !== !!r.commandRef, "Give either an id or a commandRef");

/** Optional expectation: the action applies only if the target is still in this state (conflict detection). */
const expectState = z.object({ status: z.string().optional(), revision: z.number().int().optional() }).optional();

const base = { id: z.string().uuid(), actorUserId: z.string().min(1), createdAt: z.string().min(1) };

const amount = z.union([z.number(), z.string().trim().min(1)]);

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("CREATE_DOCUMENT"), docType: z.enum(Object.keys(DOCUMENT_SCHEMAS) as [keyof typeof DOCUMENT_SCHEMAS, ...(keyof typeof DOCUMENT_SCHEMAS)[]]), input: z.record(z.string(), z.unknown()) }),
  z.object({
    ...base, type: z.literal("DOCUMENT_ACTION"), target: ref, expect: expectState,
    action: z.enum(["approve", "reject", "cancel"]), reason: z.string().max(500).optional(), overrideReason: z.string().max(500).optional(),
  }),
  z.object({ ...base, type: z.literal("RECORD_CHARGE"), input: standaloneChargeSchema.omit({ documentId: true }), documentRef: ref.optional() }),
  // Sales and Purchases screens (protocol 2): the command id is the bill's or payment's one-time id on the server
  z.object({ ...base, type: z.literal("SCREEN_PURCHASE"), input: screenPurchaseSchema.omit({ requestId: true }) }),
  z.object({
    ...base, type: z.literal("PAY_SUPPLIER"),
    input: paySupplierSchema.omit({ requestId: true, allocations: true }).extend({ allocations: z.array(z.object({ bill: ref, amount })).max(100).default([]) }),
  }),
  z.object({ ...base, type: z.literal("SCREEN_SALE"), input: screenSaleSchema.omit({ requestId: true }) }),
  z.object({
    ...base, type: z.literal("RECEIVE_PAYMENT"),
    input: receivePaymentSchema.omit({ requestId: true, allocations: true }).extend({ allocations: z.array(z.object({ invoice: ref, amount })).max(100).default([]) }),
  }),
  z.object({
    ...base, type: z.literal("CHARGE_ACTION"), target: ref, expect: expectState,
    action: z.enum(["post", "reverse", "cancel"]), reason: z.string().max(500).optional(),
    post: z.object({ settlement: z.enum(["PAID", "PAYABLE"]), expenseAccountId: z.string().optional(), cashAccountId: z.string().optional(), payeeAccountId: z.string().optional(), date: z.string().optional() }).optional(),
  }),
]);

export type SyncCommand = z.infer<typeof commandSchema>;

/** Commands that reference another command must wait until that command is accepted. */
export function dependencyOf(cmd: SyncCommand): string | null {
  if (cmd.type === "DOCUMENT_ACTION" || cmd.type === "CHARGE_ACTION") return cmd.target.commandRef ?? null;
  if (cmd.type === "RECORD_CHARGE") return cmd.documentRef?.commandRef ?? null;
  // A payment for a bill made on this computer waits for that bill
  if (cmd.type === "PAY_SUPPLIER") return cmd.input.allocations.find((a) => a.bill.commandRef)?.bill.commandRef ?? null;
  if (cmd.type === "RECEIVE_PAYMENT") return cmd.input.allocations.find((a) => a.invoice.commandRef)?.invoice.commandRef ?? null;
  return null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable fingerprint of a command's content: the same id with a different body is a conflict, never a retry. */
export function commandHash(cmd: SyncCommand): string {
  return crypto.createHash("sha256").update(canonical(cmd)).digest("hex");
}

export type CommandOutcome =
  | { status: "ACCEPTED"; documentId: string | null; docNo: string | null; chargeId?: string | null; message?: string }
  | { status: "REJECTED"; message: string; code: number }
  | { status: "CONFLICT"; message: string }
  | { status: "DEFERRED"; message: string }
  /** Accepted by an office server (hub) and held until the cloud can be reached (Mode A). */
  | { status: "RELAYED"; message: string; officialNumber?: string };
