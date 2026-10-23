// src/lib/accounting/charges.ts - Freight, loading, bilty and printing charges (owner rules of 2026-10-22).
// Governing rule: recording a charge never creates a financial posting. Only the explicit "Post as expense"
// action creates a CHARGE_EXPENSE document with a balanced journal, and a charge can have at most one active
// posting. Paid now: Cr cash/bank. Payable: Cr the payee. Reversal, edit and cancel keep full history.
import { ZERO, isZero, toPlain } from "@/lib/domain/decimal";
import { postChargeExpense } from "@/lib/domain/ledger";
import {
  Actor, ChargeInput, ChargeKind, CHARGE_KINDS, PostingError, Tx, accountByCode, cancelInTx, finishPosting, getAccount,
  jsonSafe, money, newCtx, newDocument, recordChargesInTx, refFor, run, toDate,
} from "./posting";
import { getSetting, SettingKey, Db } from "./setup";
import { can } from "@/lib/permissions";

/** Posting and reversing are financial actions; recording is not (enforced here, not only in the routes). */
function requireCharge(actor: Actor, action: "write" | "delete", what: string) {
  if (!can(actor.role, "chargePosting", action)) throw new PostingError(`You are not allowed to ${what}`, 403);
}

export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = {
  FREIGHT: "Freight",
  LOADING: "Loading / unloading",
  BILTY: "Bilty",
  OTHER_PURCHASE: "Other purchase charge",
  PRINTING: "Printing charge",
};

/** Which documents a charge may refer to. */
const SOURCE_TYPES: Record<ChargeKind, string[]> = {
  FREIGHT: ["PURCHASE_INVOICE"],
  LOADING: ["PURCHASE_INVOICE"],
  BILTY: ["PURCHASE_INVOICE"],
  OTHER_PURCHASE: ["PURCHASE_INVOICE"],
  PRINTING: ["PRESS_DISPATCH", "PRESS_RECEIPT", "PRESS_RETURN"],
};

export interface StandaloneChargeInput extends ChargeInput {
  date: Date | string;
  documentId?: string;
}

export interface PostChargeInput {
  /** PAID: settled now from a cash/bank account. PAYABLE: owed to the payee. */
  settlement: "PAID" | "PAYABLE";
  /** Expense account (GL, subtype EXPENSE); defaults to the account configured for the charge kind. */
  expenseAccountId?: string;
  cashAccountId?: string;
  /** Who is owed when PAYABLE; defaults to the charge's party. */
  payeeAccountId?: string;
  /** Posting date; defaults to the charge date. */
  date?: Date | string;
}

export type ChargeEdit = Partial<Pick<StandaloneChargeInput, "kind" | "amount" | "description" | "date" | "partyAccountId" | "reference">>;

async function loadCharge(tx: Tx, id: string) {
  const charge = await tx.chargeRecord.findUnique({ where: { id } });
  if (!charge) throw new PostingError("Charge not found", 404);
  return charge;
}

async function chargeAudit(tx: Tx, id: string, action: string, userId: string, extra: { reason?: string; before?: unknown; after?: unknown } = {}) {
  await tx.auditLog.create({
    data: {
      entity: "ChargeRecord", entityId: id, action, userId, reason: extra.reason,
      before: extra.before === undefined ? null : jsonSafe(extra.before), after: extra.after === undefined ? null : jsonSafe(extra.after),
    },
  });
}

/** Record a charge on its own (optionally referring to a purchase or press document). Posts nothing. */
export function recordCharge(db: Db, actor: Actor, input: StandaloneChargeInput) {
  return run(db, async (tx) => {
    if (!CHARGE_KINDS.includes(input.kind)) throw new PostingError(`Charge type must be one of ${CHARGE_KINDS.join(", ")}`);
    let doc: { id: string; date: Date; partyAccountId: string | null } | null = null;
    if (input.documentId) {
      const found = await tx.accountingDocument.findUnique({ where: { id: input.documentId } });
      if (!found) throw new PostingError("Referenced document not found", 404);
      if (!SOURCE_TYPES[input.kind].includes(found.type)) throw new PostingError(`A ${CHARGE_KIND_LABEL[input.kind].toLowerCase()} must refer to a ${SOURCE_TYPES[input.kind].join(" or ").toLowerCase().replace(/_/g, " ")}`);
      doc = found;
    }
    const [charge] = await recordChargesInTx(tx, actor, doc, doc?.partyAccountId ?? null, [{ ...input, date: input.date }], CHARGE_KINDS);
    return charge;
  });
}

async function postInTx(tx: Tx, actor: Actor, id: string, input: PostChargeInput) {
  requireCharge(actor, "write", "post charges as expenses");
  const charge = await loadCharge(tx, id);
  if (charge.status !== "RECORDED") throw new PostingError(charge.status === "POSTED" ? "This charge is already posted as an expense" : "A cancelled charge cannot be posted", 409);
  const amount = money(charge.amount, "Charge amount");

  let expense;
  if (input.expenseAccountId) {
    expense = await getAccount(tx, input.expenseAccountId, [], "Expense account");
    if (expense.kind !== "GL" || expense.subType !== "EXPENSE") throw new PostingError(`"${expense.name}" is not an expense account`);
  } else {
    expense = await accountByCode(tx, String(await getSetting(tx, `CHARGE_EXPENSE_${charge.kind}` as SettingKey)));
  }

  let credit;
  let party = null;
  let cash = null;
  if (input.settlement === "PAID") {
    if (!input.cashAccountId) throw new PostingError("Choose the cash or bank account the charge was paid from");
    cash = await getAccount(tx, input.cashAccountId, ["CASH_BANK"], "Cash/bank account");
    credit = cash;
  } else if (input.settlement === "PAYABLE") {
    const payeeId = input.payeeAccountId ?? charge.partyAccountId;
    if (!payeeId) throw new PostingError("Choose who the charge is owed to");
    party = await getAccount(tx, payeeId, ["PARTY"], "Payee");
    credit = party;
  } else {
    throw new PostingError("Choose whether the charge was paid now or is still payable");
  }

  const date = input.date ? toDate(input.date) : charge.date;
  const doc = await newDocument(tx, {
    type: "CHARGE_EXPENSE", date, status: "POSTED", partyAccountId: party?.id ?? null, cashAccountId: cash?.id ?? null,
    counterAccountId: expense.id, chargeId: charge.id, remarks: `${charge.chargeNo} ${CHARGE_KIND_LABEL[charge.kind as ChargeKind]}: ${charge.description}`,
    createdById: actor.id, postedAt: new Date(),
  }, { series: "EXP" });

  // Claim the charge: only one request can move it from RECORDED to POSTED, so a repeated or
  // simultaneous submission fails here and its transaction (including the document above) rolls back.
  const claimed = await tx.chargeRecord.updateMany({ where: { id, status: "RECORDED", postedDocumentId: null }, data: { status: "POSTED", postedDocumentId: doc.id } });
  if (claimed.count !== 1) throw new PostingError("This charge is already posted as an expense", 409);

  const entry = postChargeExpense({ expense: refFor(expense), credit: refFor(credit), amount });
  const ctx = await newCtx(tx, doc.id, date);
  const posted = await finishPosting(tx, ctx, doc, entry, actor, { party, total: { exact: amount, total: amount, roundingAdjustment: ZERO } });
  await chargeAudit(tx, id, "POST", actor.id, { after: { documentId: doc.id, docNo: doc.docNo, settlement: input.settlement, expense: expense.code, credit: credit.code } });
  return { charge: await tx.chargeRecord.findUniqueOrThrow({ where: { id } }), document: posted };
}

/** Undo the active expense posting (journal reversed, both kept); the charge returns to "record only". */
async function unpostInTx(tx: Tx, actor: Actor, id: string, reason: string, action = "UNPOST") {
  requireCharge(actor, "delete", "reverse an expense posting");
  if (!reason?.trim()) throw new PostingError("A reason is required");
  const charge = await loadCharge(tx, id);
  if (charge.status !== "POSTED" || !charge.postedDocumentId) throw new PostingError("This charge has no expense posting to reverse", 409);
  const released = await tx.chargeRecord.updateMany({ where: { id, status: "POSTED", postedDocumentId: charge.postedDocumentId }, data: { status: "RECORDED", postedDocumentId: null } });
  if (released.count !== 1) throw new PostingError("This charge was changed by someone else; reload and try again", 409);
  await cancelInTx(tx, actor, charge.postedDocumentId, `Charge ${charge.chargeNo}: ${reason}`, "CANCEL", { fromCharge: true });
  await chargeAudit(tx, id, action, actor.id, { reason, before: { status: "POSTED", documentId: charge.postedDocumentId } });
  return charge.postedDocumentId;
}

export function postChargeAsExpense(db: Db, actor: Actor, id: string, input: PostChargeInput) {
  return run(db, (tx) => postInTx(tx, actor, id, input));
}

export function reverseChargePosting(db: Db, actor: Actor, id: string, reason: string) {
  return run(db, async (tx) => {
    const reversedDocumentId = await unpostInTx(tx, actor, id, reason);
    return { charge: await tx.chargeRecord.findUniqueOrThrow({ where: { id } }), reversedDocumentId };
  });
}

/**
 * Edit a charge. A posted charge is first reversed (its expense document is cancelled, history kept) and
 * comes back as "record only" with the new values; the user decides whether to post it again.
 */
export function editCharge(db: Db, actor: Actor, id: string, patch: ChargeEdit, reason: string) {
  return run(db, async (tx) => {
    if (!reason?.trim()) throw new PostingError("A reason is required");
    const before = await loadCharge(tx, id);
    if (before.status === "CANCELLED") throw new PostingError("A cancelled charge cannot be edited", 409);
    const reversedDocumentId = before.status === "POSTED" ? await unpostInTx(tx, actor, id, `Edited: ${reason}`, "UNPOST_FOR_EDIT") : null;
    const data: Record<string, unknown> = {};
    if (patch.kind !== undefined) {
      if (!CHARGE_KINDS.includes(patch.kind)) throw new PostingError("Unknown charge type");
      data.kind = patch.kind;
    }
    if (patch.amount !== undefined) {
      const amount = money(patch.amount, "Charge amount");
      if (isZero(amount)) throw new PostingError("Charge amount must be more than zero");
      data.amount = toPlain(amount);
    }
    if (patch.description !== undefined) {
      if (!patch.description.trim()) throw new PostingError("Describe the charge");
      data.description = patch.description.trim();
    }
    if (patch.date !== undefined) data.date = toDate(patch.date);
    if (patch.partyAccountId !== undefined) {
      if (patch.partyAccountId) await getAccount(tx, patch.partyAccountId, ["PARTY"], "Charge party");
      data.partyAccountId = patch.partyAccountId || null;
    }
    if (patch.reference !== undefined) data.reference = patch.reference || null;
    const after = await tx.chargeRecord.update({ where: { id }, data });
    await chargeAudit(tx, id, "EDIT", actor.id, { reason, before, after });
    return { charge: after, reversedDocumentId };
  });
}

/** Cancel a charge record; an active expense posting is reversed first. Nothing is deleted. */
export function cancelCharge(db: Db, actor: Actor, id: string, reason: string) {
  return run(db, async (tx) => {
    if (!reason?.trim()) throw new PostingError("A reason is required");
    const charge = await loadCharge(tx, id);
    if (charge.status === "CANCELLED") throw new PostingError("This charge is already cancelled", 409);
    const reversedDocumentId = charge.status === "POSTED" ? await unpostInTx(tx, actor, id, `Cancelled: ${reason}`, "UNPOST_FOR_CANCEL") : null;
    const after = await tx.chargeRecord.update({ where: { id }, data: { status: "CANCELLED", cancelledById: actor.id, cancelledAt: new Date(), cancelReason: reason } });
    await chargeAudit(tx, id, "CANCEL", actor.id, { reason, before: { status: charge.status } });
    return { charge: after, reversedDocumentId };
  });
}

export async function listCharges(db: Db, filter: { status?: string; kind?: string; documentId?: string } = {}) {
  return db.chargeRecord.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.documentId ? { documentId: filter.documentId } : {}) },
    include: { document: { select: { id: true, docNo: true, type: true } }, postings: { select: { id: true, docNo: true, status: true, date: true }, orderBy: { createdAt: "asc" } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
  });
}

