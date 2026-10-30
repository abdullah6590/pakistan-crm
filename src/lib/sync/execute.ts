// src/lib/sync/execute.ts - Ledger authority: execute a device's command exactly once (Report 21 §3).
// The command, its postings and its idempotency record are written in ONE transaction, so a crash or a
// retried request can never post twice. Rejections and conflicts are stored too, so retries are deterministic.
import type { PrismaClient } from "@prisma/client";
import { can, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { DOCUMENT_SCHEMAS } from "@/lib/accounting/schemas";
import {
  Actor, PostingError, Tx, run, approveDocument, rejectDocument, cancelDocument, withAssignedNumber, DOCUMENT_SERIES,
  createSaleInvoice, createCashSale, createPurchaseInvoice, createStockIssue, createPressDispatch, createPressReturn, createPressReceipt,
  createPressLoss, createVoucher, createTransfer, createOpeningBalance, createSaleReturn, createPurchaseReturn, createStockAdjustment,
} from "@/lib/accounting/posting";
import { recordCharge, postChargeAsExpense, reverseChargePosting, cancelCharge } from "@/lib/accounting/charges";
import { CommandOutcome, SyncCommand, commandHash, commandSchema } from "./commands";
import { paySupplier } from "@/lib/accounting/payables";
import { receivePayment } from "@/lib/accounting/receivables";
import { createScreenPurchase, partyForSupplier } from "@/lib/purchases/books-purchases";
import { accountForPayment, createScreenSale, partyForCustomer } from "@/lib/sales/books-sales";

type Creator = (db: Tx, actor: Actor, input: never) => Promise<{ id: string; docNo: string }>;
const CREATE: Record<string, Creator> = {
  SALE_INVOICE: createSaleInvoice as unknown as Creator,
  CASH_SALE: createCashSale as unknown as Creator,
  PURCHASE_INVOICE: createPurchaseInvoice as unknown as Creator,
  STOCK_ISSUE: createStockIssue as unknown as Creator,
  PRESS_DISPATCH: createPressDispatch as unknown as Creator,
  PRESS_RETURN: createPressReturn as unknown as Creator,
  PRESS_RECEIPT: createPressReceipt as unknown as Creator,
  PRESS_LOSS: createPressLoss as unknown as Creator,
  VOUCHER: createVoucher as unknown as Creator,
  TRANSFER: createTransfer as unknown as Creator,
  OPENING_BALANCE: createOpeningBalance as unknown as Creator,
  SALE_RETURN: createSaleReturn as unknown as Creator,
  PURCHASE_RETURN: createPurchaseReturn as unknown as Creator,
  STOCK_ADJUSTMENT: createStockAdjustment as unknown as Creator,
};

export class Deferred extends Error {}
export class Conflict extends Error {}

/** The acting user as the authority knows them now: an offline role change is enforced at sync time. */
async function actorFor(tx: Tx, userId: string): Promise<Actor> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive) throw new PostingError("The user who entered this is no longer active", 403);
  return { id: user.id, role: user.role };
}

function requirePermission(actor: Actor, resource: string, action: "read" | "write" | "delete") {
  if (!can(actor.role, resource, action)) throw new PostingError("The user who entered this is not allowed to do it", 403);
}

async function resolveDocument(tx: Tx, target: { id?: string; commandRef?: string }) {
  const doc = target.id
    ? await tx.accountingDocument.findUnique({ where: { id: target.id } })
    : await tx.accountingDocument.findUnique({ where: { commandId: target.commandRef! } });
  if (!doc) {
    if (target.commandRef) throw new Deferred("The document this refers to has not been synchronised yet");
    throw new PostingError("Document not found", 404);
  }
  return doc;
}

async function resolveCharge(tx: Tx, target: { id?: string; commandRef?: string }) {
  const charge = target.id
    ? await tx.chargeRecord.findUnique({ where: { id: target.id } })
    : await tx.chargeRecord.findUnique({ where: { commandId: target.commandRef! } });
  if (!charge) {
    if (target.commandRef) throw new Deferred("The charge this refers to has not been synchronised yet");
    throw new PostingError("Charge not found", 404);
  }
  return charge;
}

function checkExpectation(current: { status: string; revision?: number }, expect?: { status?: string; revision?: number }) {
  if (!expect) return;
  if (expect.status && expect.status !== current.status) {
    throw new Conflict(`Changed elsewhere: it is now ${current.status.toLowerCase().replace("_", " ")}, not ${expect.status.toLowerCase().replace("_", " ")}`);
  }
  if (expect.revision !== undefined && current.revision !== undefined && expect.revision !== current.revision) {
    throw new Conflict(`Changed elsewhere: revision ${current.revision}, expected ${expect.revision}`);
  }
}

/** Carry out one command inside the caller's transaction (also used for local previews, which roll back). */
export async function perform(tx: Tx, cmd: SyncCommand, deviceId: string): Promise<CommandOutcome & { status: "ACCEPTED" }> {
  const actor = await actorFor(tx, cmd.actorUserId);
  if (cmd.type === "CREATE_DOCUMENT") {
    requirePermission(actor, DOCUMENT_RESOURCE[cmd.docType], "write");
    const input = DOCUMENT_SCHEMAS[cmd.docType].parse(cmd.input);
    const doc = await CREATE[cmd.docType](tx, actor, input as never);
    await tx.accountingDocument.update({ where: { id: doc.id }, data: { commandId: cmd.id, originDeviceId: deviceId } });
    return { status: "ACCEPTED", documentId: doc.id, docNo: doc.docNo };
  }
  if (cmd.type === "DOCUMENT_ACTION") {
    const doc = await resolveDocument(tx, cmd.target);
    checkExpectation(doc, cmd.expect);
    if (cmd.action === "approve" || cmd.action === "reject") requirePermission(actor, "stockApproval", "write");
    else requirePermission(actor, DOCUMENT_RESOURCE[doc.type], "delete");
    const after = cmd.action === "approve" ? await approveDocument(tx, actor, doc.id, { overrideReason: cmd.overrideReason })
      : cmd.action === "reject" ? await rejectDocument(tx, actor, doc.id, cmd.reason ?? "")
      : await cancelDocument(tx, actor, doc.id, cmd.reason ?? "");
    return { status: "ACCEPTED", documentId: after.id, docNo: after.docNo };
  }
  if (cmd.type === "SCREEN_PURCHASE") {
    requirePermission(actor, "purchases", "write");
    if (cmd.input.paidNow && Number(cmd.input.paidNow.amount) > 0) requirePermission(actor, "supplierPayments", "write");
    const r = await createScreenPurchase(tx, actor, {
      ...cmd.input, vendorBillDate: cmd.input.vendorBillDate || null, dueDate: cmd.input.dueDate || null, biltyDate: cmd.input.biltyDate || null, requestId: cmd.id,
    });
    await tx.accountingDocument.updateMany({ where: { id: { in: [r.document.id, ...(r.payment ? [r.payment.id] : [])] } }, data: { originDeviceId: deviceId } });
    return { status: "ACCEPTED", documentId: r.document.id, docNo: r.document.docNo };
  }
  if (cmd.type === "PAY_SUPPLIER") {
    requirePermission(actor, "supplierPayments", "write");
    const { allocations, supplierId, method, cashAccountId, ...rest } = cmd.input;
    const bills = [];
    for (const a of allocations) bills.push({ billId: (await resolveDocument(tx, a.bill)).id, amount: a.amount });
    const party = await partyForSupplier(tx, supplierId, actor.id, { allowInactive: true });
    const cash = await accountForPayment(tx, method, cashAccountId, actor.id);
    const r = await paySupplier(tx, actor, { ...rest, partyAccountId: party.id, cashAccountId: cash.id, allocations: bills, requestId: cmd.id });
    await tx.accountingDocument.update({ where: { id: r.payment.id }, data: { originDeviceId: deviceId } });
    return { status: "ACCEPTED", documentId: r.payment.id, docNo: r.payment.docNo };
  }
  if (cmd.type === "SCREEN_SALE") {
    requirePermission(actor, "sales", "write");
    const r = await createScreenSale(tx, actor, { ...cmd.input, requestId: cmd.id });
    await tx.accountingDocument.updateMany({ where: { id: { in: [r.document.id, ...(r.receipt ? [r.receipt.id] : [])] } }, data: { originDeviceId: deviceId } });
    return { status: "ACCEPTED", documentId: r.document.id, docNo: r.document.docNo };
  }
  if (cmd.type === "RECEIVE_PAYMENT") {
    requirePermission(actor, "customerPayments", "write");
    const { allocations, customerId, method, cashAccountId, ...rest } = cmd.input;
    const invoices = [];
    for (const a of allocations) invoices.push({ invoiceId: (await resolveDocument(tx, a.invoice)).id, amount: a.amount });
    const party = await partyForCustomer(tx, customerId, actor.id);
    const cash = await accountForPayment(tx, method, cashAccountId, actor.id);
    const r = await receivePayment(tx, actor, { ...rest, partyAccountId: party.id, cashAccountId: cash.id, allocations: invoices, requestId: cmd.id });
    await tx.accountingDocument.update({ where: { id: r.receipt.id }, data: { originDeviceId: deviceId } });
    return { status: "ACCEPTED", documentId: r.receipt.id, docNo: r.receipt.docNo };
  }
  if (cmd.type === "RECORD_CHARGE") {
    requirePermission(actor, "charges", "write");
    const documentId = cmd.documentRef ? (await resolveDocument(tx, cmd.documentRef)).id : undefined;
    const charge = await recordCharge(tx, actor, { ...cmd.input, documentId } as never);
    await tx.chargeRecord.update({ where: { id: charge.id }, data: { commandId: cmd.id } });
    return { status: "ACCEPTED", documentId: null, docNo: charge.chargeNo, chargeId: charge.id };
  }
  const charge = await resolveCharge(tx, cmd.target);
  checkExpectation(charge, cmd.expect);
  if (cmd.action === "post") {
    if (!cmd.post) throw new PostingError("Posting details are missing");
    const r = await postChargeAsExpense(tx, actor, charge.id, cmd.post);
    return { status: "ACCEPTED", documentId: r.document.id, docNo: r.document.docNo, chargeId: charge.id };
  }
  if (cmd.action === "reverse") {
    await reverseChargePosting(tx, actor, charge.id, cmd.reason ?? "");
  } else {
    requirePermission(actor, "charges", "delete");
    await cancelCharge(tx, actor, charge.id, cmd.reason ?? "");
  }
  return { status: "ACCEPTED", documentId: null, docNo: charge.chargeNo, chargeId: charge.id };
}

async function stored(db: PrismaClient | Tx, deviceId: string, commandId: string) {
  return db.syncInbox.findUnique({ where: { deviceId_commandId: { deviceId, commandId } } });
}

/**
 * Execute one command from a device. Returns the outcome stored for (device, command): ACCEPTED with the
 * official document, REJECTED (business rule or permission), CONFLICT, or DEFERRED (dependency not yet here).
 */
/** The series a create command will be numbered in. */
export function seriesOf(cmd: SyncCommand): string | null {
  // A bill from the Purchases or Sales screen is numbered in its bill series; a payment's series depends on the
  // account (cash or bank) and is numbered by the server
  if (cmd.type === "SCREEN_PURCHASE") return DOCUMENT_SERIES.PURCHASE_INVOICE;
  if (cmd.type === "SCREEN_SALE") return cmd.input.customerId ? DOCUMENT_SERIES.SALE_INVOICE : DOCUMENT_SERIES.CASH_SALE;
  if (cmd.type !== "CREATE_DOCUMENT") return null;
  return cmd.docType === "VOUCHER" ? String((cmd.input as { series?: unknown }).series ?? "") : DOCUMENT_SERIES[cmd.docType] ?? null;
}

/** A number assigned by an office server must lie in a block the cloud reserved for that server, and be unused. */
async function checkAssigned(tx: Tx, series: string, number: number, hubId: string) {
  const block = await tx.numberBlock.findFirst({ where: { series, deviceId: hubId, fromNumber: { lte: number }, toNumber: { gte: number }, status: { not: "RELEASED" } } });
  if (!block) throw new Conflict(`${series}-${number} is not in a number block reserved for this office server`);
  if (await tx.accountingDocument.findFirst({ where: { series, number, revision: 0 } })) throw new Conflict(`${series}-${number} is already used`);
}

export async function executeCommand(db: PrismaClient, deviceId: string, raw: unknown, opts: { assigned?: { number: number; hubId: string } } = {}): Promise<CommandOutcome> {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) return { status: "REJECTED", message: `Invalid command: ${parsed.error.issues[0]?.message ?? "malformed"}`, code: 400 };
  const cmd = parsed.data;
  const hash = commandHash(cmd);

  const replay = async (): Promise<CommandOutcome | null> => {
    const prior = await stored(db, deviceId, cmd.id);
    if (!prior) return null;
    if (prior.requestHash !== hash) return { status: "CONFLICT", message: "This command id was already used with different content" };
    return JSON.parse(prior.result) as CommandOutcome;
  };
  const earlier = await replay();
  if (earlier) return earlier;

  // Recovery (Report 23 §4): entries rescued from a failed computer's backup arrive from its replacement. A command
  // id already executed for any computer is never executed again; identical content gets the stored answer.
  const elsewhere = await db.syncInbox.findFirst({ where: { commandId: cmd.id } });
  if (elsewhere) {
    if (elsewhere.requestHash !== hash) return { status: "CONFLICT", message: "This entry id was already used with different content" };
    await db.syncInbox.create({ data: { deviceId, commandId: cmd.id, requestHash: hash, status: elsewhere.status, result: elsewhere.result, documentId: elsewhere.documentId } }).catch(() => undefined);
    return JSON.parse(elsewhere.result) as CommandOutcome;
  }

  try {
    return await run(db, async (tx) => {
      const series = seriesOf(cmd);
      let outcome: CommandOutcome & { status: "ACCEPTED" };
      if (opts.assigned && series) {
        await checkAssigned(tx, series, opts.assigned.number, opts.assigned.hubId);
        outcome = await withAssignedNumber(series, opts.assigned.number, () => perform(tx, cmd, deviceId));
      } else {
        outcome = await perform(tx, cmd, deviceId);
      }
      await tx.syncInbox.create({ data: { deviceId, commandId: cmd.id, requestHash: hash, status: "ACCEPTED", result: JSON.stringify(outcome), documentId: outcome.documentId } });
      return outcome;
    });
  } catch (e) {
    if (e instanceof Deferred) return { status: "DEFERRED", message: e.message };
    // A simultaneous request for the same command may have won the race: return what it stored
    const raced = await replay();
    if (raced) return raced;
    // A server-side fault (status 500) is not the command's fault: store nothing so the device retries
    const outcome: CommandOutcome = e instanceof Conflict ? { status: "CONFLICT", message: e.message }
      : e instanceof PostingError && e.status < 500 ? { status: "REJECTED", message: e.message, code: e.status }
      : e instanceof Error && e.name === "ZodError" ? { status: "REJECTED", message: "Invalid data in the command", code: 400 }
      : null as never;
    if (!outcome) throw e; // infrastructure failure: nothing stored, the device retries later
    try {
      await db.syncInbox.create({ data: { deviceId, commandId: cmd.id, requestHash: hash, status: outcome.status, result: JSON.stringify(outcome) } });
    } catch {
      const r = await replay();
      if (r) return r;
    }
    return outcome;
  }
}
