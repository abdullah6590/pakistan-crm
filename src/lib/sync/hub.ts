// src/lib/sync/hub.ts - Office server (Mode A, Report 21 §11): relay and share office entries during an outage.
// A hub never posts to the ledger. It keeps office computers' commands in its own ordered outbox, shows them to
// the other office computers (shared pending stock and balances), and forwards them to the cloud on behalf of
// the computer that created them. The cloud's idempotency key is (creating computer, command id), so an entry
// that also reaches the cloud directly can never be posted twice.
import type { PrismaClient } from "@prisma/client";
import { CommandOutcome, commandHash, commandSchema, dependencyOf, SyncCommand } from "./commands";
import { seriesOf } from "./execute";
import { DOCUMENT_SERIES, VOUCHER_SERIES } from "@/lib/accounting/posting";

/**
 * Series an office server numbers from reserved blocks (owner decision D-3 / OD-19, 2026-10-22: on by default).
 * `CRM_HUB_NUMBER_SERIES` unset: every document and voucher series; "none": off; otherwise a comma-separated list.
 * Blocks are reserved per business (each business has its own database) and per series, never overlap, and the
 * cloud refuses any number outside the sending server's block or already used.
 */
export function hubNumberSeries(value = process.env.CRM_HUB_NUMBER_SERIES): string[] {
  const v = (value ?? "").trim();
  if (!v) return [...new Set([...Object.values(DOCUMENT_SERIES), ...VOUCHER_SERIES])];
  if (/^(none|off)$/i.test(v)) return [];
  return [...new Set(v.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))];
}

/**
 * Next official number from this hub's reserved blocks, if any (Report 21 §12). Counted from the hub's own queue,
 * never by writing to the replicated block table.
 */
async function assignFromBlock(db: PrismaClient, hubId: string, cmd: SyncCommand): Promise<string | null> {
  const series = seriesOf(cmd);
  if (!series) return null;
  const blocks = await db.numberBlock.findMany({ where: { series, deviceId: hubId, status: { not: "RELEASED" } }, orderBy: { fromNumber: "asc" } });
  if (!blocks.length) return null;
  const taken = new Set(
    (await db.outboxCommand.findMany({ where: { officialNumber: { startsWith: `${series}-` } }, select: { officialNumber: true } }))
      .map((r) => Number(r.officialNumber!.slice(series.length + 1))),
  );
  const used = await db.accountingDocument.findMany({ where: { series, revision: 0 }, select: { number: true } });
  for (const u of used) taken.add(u.number);
  for (const b of blocks) {
    for (let n = b.fromNumber; n <= b.toNumber; n++) if (!taken.has(n)) return `${series}-${String(n).padStart(4, "0")}`;
  }
  return null; // blocks used up: the entry keeps its provisional reference and is numbered by the cloud
}

export interface OfficeEntry {
  id: string;
  seq: number;
  originDeviceId: string;
  payload: string;
}

/** Accept office computers' commands into the hub queue. Retries return the queue's current knowledge. */
export async function relayCommands(db: PrismaClient, requesterId: string, commands: unknown[], hubId?: string): Promise<{ id: string; outcome: CommandOutcome }[]> {
  if (!Array.isArray(commands) || commands.length > 200) throw new Error("Send 1-200 commands at a time");
  const out: { id: string; outcome: CommandOutcome }[] = [];
  for (const raw of commands) {
    const parsed = commandSchema.safeParse(raw);
    const id = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : "";
    if (!parsed.success) {
      out.push({ id, outcome: { status: "REJECTED", message: `Invalid command: ${parsed.error.issues[0]?.message ?? "malformed"}`, code: 400 } });
      continue;
    }
    const cmd = parsed.data;
    const existing = await db.outboxCommand.findUnique({ where: { id: cmd.id } });
    if (existing) {
      if (existing.originDeviceId !== requesterId) {
        out.push({ id, outcome: { status: "CONFLICT", message: "This entry id belongs to another computer" } });
      } else if (commandHash(commandSchema.parse(JSON.parse(existing.payload))) !== commandHash(cmd)) {
        out.push({ id, outcome: { status: "CONFLICT", message: "This command id was already used with different content" } });
      } else if (existing.status === "SYNCED" || existing.status === "NEEDS_REVIEW") {
        out.push({ id, outcome: existing.result ? (JSON.parse(existing.result) as CommandOutcome) : { status: "REJECTED", message: existing.lastError ?? "Needs review", code: 409 } });
      } else if (existing.status === "CANCELLED") {
        out.push({ id, outcome: { status: "REJECTED", message: existing.lastError ?? "Withdrawn at the office server", code: 409 } });
      } else {
        out.push({ id, outcome: { status: "RELAYED", message: "Held by the office server until the main server can be reached", officialNumber: existing.officialNumber ?? undefined } });
      }
      continue;
    }
    let officialNumber: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await db.$transaction(async (tx) => {
          const last = await tx.outboxCommand.findFirst({ where: { seq: { gt: 0 } }, orderBy: { seq: "desc" }, select: { seq: true } });
          officialNumber = hubId ? await assignFromBlock(tx as unknown as PrismaClient, hubId, cmd) : null;
          await tx.outboxCommand.create({
            data: {
              id: cmd.id, seq: (last?.seq ?? 0) + 1, type: cmd.type, payload: JSON.stringify(cmd), dependsOn: dependencyOf(cmd),
              originDeviceId: requesterId, status: "PENDING_SYNC", createdById: cmd.actorUserId, officialNumber,
            },
          });
        });
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002" || attempt === 4) throw e;
      }
    }
    out.push({ id, outcome: { status: "RELAYED", message: "Held by the office server until the main server can be reached", officialNumber: officialNumber ?? undefined } });
  }
  return out;
}

/** Office entries not yet accepted by the cloud, in hub order: every office computer includes them in previews. */
export async function officePending(db: PrismaClient): Promise<OfficeEntry[]> {
  const rows = await db.outboxCommand.findMany({
    where: { status: { in: ["PENDING_SYNC", "SYNCING", "FAILED_RETRY"] }, originDeviceId: { not: null }, seq: { gt: 0 } },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, originDeviceId: true, payload: true },
  });
  return rows.map((r) => ({ id: r.id, seq: r.seq, originDeviceId: r.originDeviceId!, payload: r.payload }));
}

/** On an office computer: replace its copy of other computers' office entries with the hub's current list. */
export const OFFICE_SEQ_BASE = -1_000_000_000;
export async function refreshOfficePending(db: PrismaClient, entries: OfficeEntry[]) {
  await db.$transaction(async (tx) => {
    await tx.outboxCommand.deleteMany({ where: { status: "OFFICE_PENDING" } });
    const own = new Set((await tx.outboxCommand.findMany({ where: { id: { in: entries.map((e) => e.id) } }, select: { id: true } })).map((r) => r.id));
    for (const e of entries) {
      if (own.has(e.id)) continue;
      const cmd = JSON.parse(e.payload);
      await tx.outboxCommand.create({
        data: { id: e.id, seq: OFFICE_SEQ_BASE + e.seq, type: cmd.type, payload: e.payload, originDeviceId: e.originDeviceId, status: "OFFICE_PENDING", createdById: cmd.actorUserId },
      });
    }
  });
}

/**
 * Keep reserved number blocks topped up while the internet is available, for the series from hubNumberSeries().
 * Requests a new block when fewer than a fifth remain.
 */
export async function ensureNumberBlocks(db: PrismaClient, hubId: string, seriesList: string[], size: number, reserve: (series: string, size: number) => Promise<unknown>) {
  const requested: string[] = [];
  for (const series of seriesList) {
    const blocks = await db.numberBlock.findMany({ where: { series, deviceId: hubId, status: { not: "RELEASED" } } });
    const taken = new Set(
      (await db.outboxCommand.findMany({ where: { officialNumber: { startsWith: `${series}-` } }, select: { officialNumber: true } }))
        .map((r) => Number(r.officialNumber!.slice(series.length + 1))),
    );
    for (const u of await db.accountingDocument.findMany({ where: { series, revision: 0 }, select: { number: true } })) taken.add(u.number);
    let free = 0;
    for (const b of blocks) for (let n = b.fromNumber; n <= b.toNumber; n++) if (!taken.has(n)) free++;
    if (free < Math.ceil(size / 5)) {
      await reserve(series, size);
      requested.push(series);
    }
  }
  return requested;
}
