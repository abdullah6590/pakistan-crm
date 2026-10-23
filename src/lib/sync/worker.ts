// src/lib/sync/worker.ts - Device / hub sync cycle: push the outbox in order, then pull changes (Report 21 §3, §5).
// Safe to repeat at any moment: the authority is idempotent per command, and replica batches are atomic.
import type { PrismaClient } from "@prisma/client";
import { CommandOutcome } from "./commands";
import crypto from "node:crypto";
import { Change, SyncEpoch, setSyncEpoch } from "./server";
import { applyChanges, applySnapshot, cursorOf } from "./replica";
import type { WireValue } from "./tables";
import { OfficeEntry, refreshOfficePending } from "./hub";

export interface Transport {
  /** Identifies the upstream (cloud or office server) for the change-feed cursor. */
  upstreamId: string;
  /** Items are commands, or `{ relayFor, command }` when a hub forwards an office computer's entry. */
  push(items: unknown[]): Promise<{ id: string; outcome: CommandOutcome }[]>;
  pull(since: number): Promise<{ changes: Change[]; lastSeq: number; more: boolean; epoch?: SyncEpoch }>;
  snapshot(): Promise<{ atSeq: number; tables: { name: string; rows: Record<string, WireValue>[] }[]; epoch?: SyncEpoch }>;
  /** Only when the upstream is an office hub: other office computers' entries not yet at the cloud. */
  office?(): Promise<OfficeEntry[]>;
  /** Only from a hub to the cloud: reserve a block of official numbers. */
  reserve?(series: string, size: number): Promise<unknown>;
}

export class NetworkError extends Error {}

export interface SyncReport {
  startedAt: string;
  pushed: number;
  accepted: number;
  needsReview: number;
  deferred: number;
  pulled: number;
  lastSeq: number | null;
  /** Set when the upstream was restored from a backup and this computer resynchronised (Report 23 §5). */
  upstreamRestored?: { resent: number; backupCreatedAt: string | null };
  error?: string;
}

/** Exponential backoff with jitter: 5 s, 10 s, 20 s ... capped at 30 minutes. */
export function backoffMs(attempts: number, random = Math.random): number {
  const base = Math.min(30 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** A command interrupted mid-push (crash, power cut) is simply sent again: the authority deduplicates it. */
export async function recoverInterrupted(db: PrismaClient) {
  return (await db.outboxCommand.updateMany({ where: { status: "SYNCING" }, data: { status: "PENDING_SYNC" } })).count;
}

async function pushOnce(db: PrismaClient, transport: Transport, report: SyncReport, now: Date) {
  // Strict order (D-010): entries go in the order they were made. A later entry never overtakes an earlier one
  // that is still waiting for its retry time. RELAYED entries are asked about again each cycle until the hub
  // reports the cloud's final answer; they are already queued upstream, so they do not hold others back.
  const queue = await db.outboxCommand.findMany({
    where: { status: { in: ["PENDING_SYNC", "RELAYED", "FAILED_RETRY"] }, seq: { gt: 0 } },
    orderBy: { seq: "asc" },
    take: 100,
  });
  const candidates = [];
  for (const c of queue) {
    if (c.status === "FAILED_RETRY" && c.nextAttemptAt && c.nextAttemptAt > now) break;
    candidates.push(c);
  }
  if (!candidates.length) return false;
  // A command waits while the command it depends on is not yet accepted (unless it is earlier in this batch)
  const batchIds = new Set<string>();
  const batch = [];
  for (const c of candidates) {
    if (c.dependsOn && !batchIds.has(c.dependsOn)) {
      const parent = await db.outboxCommand.findUnique({ where: { id: c.dependsOn }, select: { status: true } });
      if (parent && parent.status !== "SYNCED") continue;
    }
    batch.push(c);
    batchIds.add(c.id);
  }
  if (!batch.length) return false;
  await db.outboxCommand.updateMany({ where: { id: { in: batch.map((c) => c.id) } }, data: { status: "SYNCING" } });
  let results: { id: string; outcome: CommandOutcome }[];
  try {
    results = await transport.push(batch.map((c) => {
      const command = JSON.parse(c.payload);
      if (!c.originDeviceId) return command;
      // A hub forwards for the computer that made the entry, with the official number it assigned (if any)
      const assignedNumber = c.officialNumber ? Number(c.officialNumber.split("-").pop()) : undefined;
      return { relayFor: c.originDeviceId, command, assignedNumber };
    }));
  } catch (e) {
    for (const c of batch) {
      await db.outboxCommand.update({
        where: { id: c.id },
        data: { status: "FAILED_RETRY", attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + backoffMs(c.attempts + 1)), lastError: (e as Error).message.slice(0, 300) },
      });
    }
    throw e;
  }
  report.pushed += batch.length;
  const byId = new Map(results.map((r) => [r.id, r.outcome]));
  for (const c of batch) {
    const outcome = byId.get(c.id);
    // A parent rejected earlier in this pass has already flagged this entry: keep it flagged
    const current = await db.outboxCommand.findUnique({ where: { id: c.id }, select: { status: true } });
    if (current?.status === "NEEDS_REVIEW" && outcome?.status !== "ACCEPTED") continue;
    if (!outcome) {
      await db.outboxCommand.update({ where: { id: c.id }, data: { status: "PENDING_SYNC" } });
      continue;
    }
    if (outcome.status === "ACCEPTED") {
      report.accepted++;
      await db.outboxCommand.update({ where: { id: c.id }, data: { status: "SYNCED", syncedAt: now, result: JSON.stringify(outcome), lastError: null } });
    } else if (outcome.status === "RELAYED") {
      await db.outboxCommand.update({ where: { id: c.id }, data: { status: "RELAYED", result: JSON.stringify(outcome), lastError: null, officialNumber: outcome.officialNumber ?? undefined } });
    } else if (outcome.status === "DEFERRED") {
      report.deferred++;
      await db.outboxCommand.update({ where: { id: c.id }, data: { status: "PENDING_SYNC", lastError: outcome.message } });
    } else {
      report.needsReview++;
      // Rejected or conflicting: keep the original entry, flag it and everything that depends on it
      const review = [c.id];
      for (let i = 0; i < review.length; i++) {
        for (const child of await db.outboxCommand.findMany({ where: { dependsOn: review[i], status: { in: ["PENDING_SYNC", "FAILED_RETRY", "SYNCING"] } } })) review.push(child.id);
      }
      await db.outboxCommand.update({ where: { id: c.id }, data: { status: "NEEDS_REVIEW", result: JSON.stringify(outcome), lastError: outcome.message } });
      if (review.length > 1) {
        await db.outboxCommand.updateMany({ where: { id: { in: review.slice(1) } }, data: { status: "NEEDS_REVIEW", lastError: "Depends on an entry that needs review" } });
      }
    }
  }
  return true;
}

async function pushAll(db: PrismaClient, transport: Transport, report: SyncReport, now: Date) {
  // Repeat while rounds make progress (a parent accepted in one round releases its children for the next)
  for (let round = 0; round < 50; round++) {
    const accepted = report.accepted;
    const sent = await pushOnce(db, transport, report, now);
    if (!sent || report.accepted === accepted) break;
  }
}

/**
 * The upstream's database was restored from a backup (its epoch changed). Entries this computer sent after that
 * backup may be missing there, so they are sent again (the authority recognises the ones it still has and never
 * posts twice), then the replica is rebuilt from a fresh snapshot, removing what the upstream no longer has. A hub
 * starts a new epoch of its own so its office computers do the same.
 */
export async function resyncAfterUpstreamRestore(db: PrismaClient, transport: Transport, epoch: SyncEpoch, report: SyncReport, now: Date): Promise<number> {
  const from = epoch.backupCreatedAt ? new Date(new Date(epoch.backupCreatedAt).getTime() - 60 * 60_000) : null;
  const resent = await db.outboxCommand.updateMany({
    where: { status: "SYNCED", seq: { gt: 0 }, ...(from ? { syncedAt: { gte: from } } : {}) },
    data: { status: "PENDING_SYNC", attempts: 0, nextAttemptAt: null, lastError: "Sent again: the server was restored from a backup" },
  });
  await pushAll(db, transport, report, now);
  const snap = await transport.snapshot();
  await applySnapshot(db, transport.upstreamId, snap, { prune: true });
  await setSyncEpoch(db, { id: crypto.randomUUID(), backupCreatedAt: epoch.backupCreatedAt });
  report.upstreamRestored = { resent: resent.count, backupCreatedAt: epoch.backupCreatedAt ?? null };
  return snap.atSeq;
}

/**
 * One full cycle. Network failures are reported, never thrown, so a scheduler can simply call this again.
 * `retryNow` (the "Sync now" button) ignores the backoff timer of entries that failed earlier.
 */
export async function syncOnce(db: PrismaClient, transport: Transport, now = new Date(), opts: { retryNow?: boolean } = {}): Promise<SyncReport> {
  const report: SyncReport = { startedAt: now.toISOString(), pushed: 0, accepted: 0, needsReview: 0, deferred: 0, pulled: 0, lastSeq: null };
  try {
    await recoverInterrupted(db);
    if (opts.retryNow) await db.outboxCommand.updateMany({ where: { status: "FAILED_RETRY" }, data: { nextAttemptAt: now } });
    await pushAll(db, transport, report, now);
    let since = await cursorOf(db, transport.upstreamId);
    if (since === null) {
      const snap = await transport.snapshot();
      await applySnapshot(db, transport.upstreamId, snap);
      since = snap.atSeq;
    }
    for (let page = 0; page < 1000; page++) {
      const batch = await transport.pull(since);
      if (page === 0 && batch.epoch) {
        const seen = (await db.syncCursor.findUnique({ where: { upstreamId: transport.upstreamId } }))?.epoch;
        if (seen && seen !== batch.epoch.id) {
          since = await resyncAfterUpstreamRestore(db, transport, batch.epoch, report, now);
          page = -1;
          continue;
        }
        if (!seen) await db.syncCursor.update({ where: { upstreamId: transport.upstreamId }, data: { epoch: batch.epoch.id } });
      }
      if (batch.changes.length || batch.lastSeq !== since) await applyChanges(db, transport.upstreamId, batch.changes, batch.lastSeq);
      report.pulled += batch.changes.length;
      since = batch.lastSeq;
      if (!batch.more) break;
    }
    report.lastSeq = since;
    if (transport.office) await refreshOfficePending(db, await transport.office());
    // The server answered, so the connection is back: retry entries still waiting on their backoff timer
    const waiting = await db.outboxCommand.updateMany({ where: { status: "FAILED_RETRY", nextAttemptAt: { gt: now } }, data: { nextAttemptAt: now } });
    if (waiting.count) await pushAll(db, transport, report, now);
  } catch (e) {
    report.error = e instanceof NetworkError ? `No connection: ${e.message}` : (e as Error).message;
  }
  return report;
}
