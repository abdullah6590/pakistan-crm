// src/lib/sync/outbox.ts - Device / hub outbox: durable queue of commands plus local previews (Report 21 §2).
// A device never posts to its ledger. It stores the command (committed with WAL + synchronous=FULL) and a
// preview computed by running the real posting service in a transaction that is always rolled back, after
// replaying the device's other pending commands, so totals, units, rounding and validation match the server.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PostingError, Tx } from "@/lib/accounting/posting";
import { CommandOutcome, commandSchema, dependencyOf } from "./commands";
import { Conflict, Deferred, perform } from "./execute";

export const OUTBOX_STATUS = {
  PENDING_SYNC: "Pending sync",
  SYNCING: "Syncing",
  SYNCED: "Synced",
  NEEDS_REVIEW: "Needs review",
  FAILED_RETRY: "Failed — retry available",
  CANCELLED: "Cancelled before sync",
  RELAYED: "Pending Sync — held by office server",
  OFFICE_PENDING: "Another office computer's entry, not yet synced",
} as const;
export type OutboxStatus = keyof typeof OUTBOX_STATUS;

/** Commands not yet accepted by the authority: they form the pending overlay. */
export const UNSENT: OutboxStatus[] = ["PENDING_SYNC", "SYNCING", "FAILED_RETRY", "RELAYED"];
/** Everything that belongs in the pending overlay: office entries (hub order) first, then this computer's. */
const OVERLAY: OutboxStatus[] = ["OFFICE_PENDING", ...UNSENT];

export interface LocalDevice {
  id: string;
  code: string;
}

class Rollback<T> extends Error {
  constructor(public value: T) {
    super("rollback");
  }
}

/** Run fn on top of the pending overlay inside a transaction that is always rolled back. */
export async function speculate<T>(db: PrismaClient, device: LocalDevice, fn: (tx: Tx) => Promise<T>, opts: { includePending?: boolean; exclude?: string } = {}): Promise<T> {
  try {
    await db.$transaction(async (tx) => {
      if (opts.includePending !== false) {
        const pending = await tx.outboxCommand.findMany({ where: { status: { in: OVERLAY }, id: opts.exclude ? { not: opts.exclude } : undefined }, orderBy: { seq: "asc" } });
        let n = 0;
        for (const row of pending) {
          const cmd = commandSchema.parse(JSON.parse(row.payload));
          // Already posted and copied here (it reached the server before this copy learned so): do not count twice (D-011)
          if (cmd.type === "CREATE_DOCUMENT" && (await tx.accountingDocument.count({ where: { commandId: cmd.id } }))) continue;
          if (cmd.type === "RECORD_CHARGE" && (await tx.chargeRecord.count({ where: { commandId: cmd.id } }))) continue;
          const sp = `pending_${n++}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
          try {
            await perform(tx, cmd, row.originDeviceId ?? device.id);
            await tx.$executeRawUnsafe(`RELEASE ${sp}`);
          } catch {
            // A pending command that no longer applies is skipped in the overlay (it will surface at sync)
            await tx.$executeRawUnsafe(`ROLLBACK TO ${sp}`);
            await tx.$executeRawUnsafe(`RELEASE ${sp}`);
          }
        }
      }
      throw new Rollback(await fn(tx));
    }, { timeout: 120_000 });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error("unreachable");
}

export interface Preview {
  outcome: string;
  docType?: string;
  docNo?: string | null;
  status?: string;
  date?: string;
  partyName?: string | null;
  exactTotal?: string;
  total?: string;
  roundingAdjustment?: string;
  previousBalance?: string | null;
  newBalance?: string | null;
  hasNegativeStock?: boolean;
  hasCostEstimate?: boolean;
  lines?: { lineNo: number; description: string | null; quantity: string; unit: string | null; loose: string; baseQuantity: string; unitPrice: string; amount: string; costAmount: string | null; costStatus: string | null; stockWarning: string | null }[];
  journal?: { account: string; debitPaisa: string; creditPaisa: string }[];
  message?: string;
}

async function describe(tx: Tx, outcome: CommandOutcome & { status: "ACCEPTED" }): Promise<Preview> {
  if (!outcome.documentId) return { outcome: "ACCEPTED", docNo: outcome.docNo, message: outcome.message };
  const doc = await tx.accountingDocument.findUniqueOrThrow({
    where: { id: outcome.documentId },
    include: { lines: { orderBy: { lineNo: "asc" } }, partyAccount: { select: { name: true } }, journalEntries: { include: { lines: { include: { account: { select: { code: true } } } } } } },
  });
  return {
    outcome: "ACCEPTED", docType: doc.type, docNo: doc.docNo, status: doc.status, date: doc.date.toISOString(), partyName: doc.partyAccount?.name ?? null,
    exactTotal: doc.exactTotal, total: doc.total, roundingAdjustment: doc.roundingAdjustment, previousBalance: doc.previousBalance, newBalance: doc.newBalance,
    hasNegativeStock: doc.hasNegativeStock, hasCostEstimate: doc.hasCostEstimate,
    lines: doc.lines.map((l) => ({ lineNo: l.lineNo, description: l.description, quantity: l.quantity, unit: l.unit, loose: l.loose, baseQuantity: l.baseQuantity, unitPrice: l.unitPrice, amount: l.amount, costAmount: l.costAmount, costStatus: l.costStatus, stockWarning: l.stockWarning })),
    journal: doc.journalEntries.flatMap((e) => e.lines.map((l) => ({ account: l.account.code, debitPaisa: l.debitPaisa.toString(), creditPaisa: l.creditPaisa.toString() }))),
  };
}

export class OutboxError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Queue a command on this device. The command is validated and previewed with the server's own rules on top
 * of everything still pending here; a command the server would reject for its content is refused now.
 */
export async function submitCommand(db: PrismaClient, device: LocalDevice, draft: Record<string, unknown>) {
  const cmd = commandSchema.safeParse({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...draft });
  if (!cmd.success) throw new OutboxError(`Invalid entry: ${cmd.error.issues[0]?.message ?? "malformed"}`);
  const command = cmd.data;
  const dependsOn = dependencyOf(command);
  if (dependsOn) {
    const parent = await db.outboxCommand.findUnique({ where: { id: dependsOn } });
    if (!parent) throw new OutboxError("This refers to an entry that is not on this computer");
    if (parent.status === "CANCELLED" || parent.status === "NEEDS_REVIEW") throw new OutboxError("The entry this refers to was cancelled or needs review");
  }

  const preview: Preview = await speculate(db, device, async (tx) => {
    try {
      return await describe(tx, await perform(tx, command, device.id));
    } catch (e) {
      if (e instanceof PostingError) throw new OutboxError(e.message, e.status);
      if (e instanceof Conflict) throw new OutboxError(e.message, 409);
      // A reference to a central document this replica does not have yet cannot be previewed
      if (e instanceof Deferred) return { outcome: "DEFERRED", message: e.message };
      throw e;
    }
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.outboxCommand.findFirst({ where: { seq: { gt: 0 } }, orderBy: { seq: "desc" }, select: { seq: true } });
        const seq = (last?.seq ?? 0) + 1;
        const provisional = command.type === "CREATE_DOCUMENT" || command.type === "RECORD_CHARGE" ? `P-${device.code}-${String(seq).padStart(5, "0")}` : null;
        return tx.outboxCommand.create({
          data: {
            id: command.id, seq, type: command.type, payload: JSON.stringify(command), preview: JSON.stringify(preview), provisionalRef: provisional,
            dependsOn, status: "PENDING_SYNC", createdById: command.actorUserId,
          },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt === 4) throw e; // seq race with another submit: retry
    }
  }
  throw new Error("unreachable");
}

/** Withdraw an unsent command; commands that depend on it are withdrawn too (they could never apply). */
export async function cancelPending(db: PrismaClient, id: string, reason: string) {
  if (!reason.trim()) throw new OutboxError("A reason is required");
  return db.$transaction(async (tx) => {
    const row = await tx.outboxCommand.findUnique({ where: { id } });
    if (!row) throw new OutboxError("Entry not found", 404);
    if (!["PENDING_SYNC", "FAILED_RETRY", "NEEDS_REVIEW"].includes(row.status)) throw new OutboxError(`An entry that is ${OUTBOX_STATUS[row.status as OutboxStatus]?.toLowerCase() ?? row.status} cannot be withdrawn`, 409);
    const withdrawn = [id];
    for (let i = 0; i < withdrawn.length; i++) {
      for (const child of await tx.outboxCommand.findMany({ where: { dependsOn: withdrawn[i], status: { in: [...UNSENT, "NEEDS_REVIEW"] } } })) withdrawn.push(child.id);
    }
    await tx.outboxCommand.updateMany({ where: { id: { in: withdrawn } }, data: { status: "CANCELLED", lastError: `Withdrawn on this computer: ${reason}` } });
    return withdrawn;
  });
}

export async function outboxSummary(db: PrismaClient) {
  const rows = await db.outboxCommand.groupBy({ by: ["status"], _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<Record<OutboxStatus, number>>;
}
