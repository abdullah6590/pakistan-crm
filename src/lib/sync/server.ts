// src/lib/sync/server.ts - Authority side of sync: device registration and authentication, push, pull, snapshot.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { executeCommand } from "./execute";
import { CommandOutcome } from "./commands";
import { REPLICATED_TABLES, TABLE_BY_NAME, WireValue, encodeRow } from "./tables";
import { isAuthority } from "./local";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export class SyncAuthError extends Error {}

/** Register a computer (device) or office server (hub). The secret is returned once and stored only hashed. */
export async function registerDevice(db: PrismaClient, input: { name: string; role: "DEVICE" | "HUB"; hubId?: string; registeredById: string }) {
  if (!input.name.trim()) throw new Error("Name the computer");
  if (input.hubId) {
    const hub = await db.device.findUnique({ where: { id: input.hubId } });
    if (!hub || hub.role !== "HUB" || hub.status !== "ACTIVE") throw new Error("Unknown office server");
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await db.device.count();
    const code = `${input.role === "HUB" ? "H" : "D"}${String(count + 1 + attempt).padStart(2, "0")}`;
    try {
      const device = await db.device.create({
        data: { code, name: input.name.trim(), role: input.role, hubId: input.hubId ?? null, secretHash: sha256(secret), registeredById: input.registeredById },
      });
      return { device, secret };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("Could not allocate a device code");
}

/** Check `<deviceId>.<secret>`; revoked devices are refused (their unsynced data stays on the device). */
export async function authenticateDevice(db: PrismaClient, credential: string | null) {
  if (!credential) throw new SyncAuthError("Missing device credential");
  const dot = credential.indexOf(".");
  if (dot < 1) throw new SyncAuthError("Malformed device credential");
  const deviceId = credential.slice(0, dot);
  const secret = credential.slice(dot + 1);
  const device = await db.device.findUnique({ where: { id: deviceId } });
  const expected = Buffer.from(device?.secretHash ?? "0".repeat(64), "hex");
  const given = Buffer.from(sha256(secret), "hex");
  if (!device || !crypto.timingSafeEqual(expected, given)) throw new SyncAuthError("Unknown device or wrong credential");
  if (device.status !== "ACTIVE") throw new SyncAuthError("This computer's access was revoked");
  // Only the cloud records "last seen"; a hub's device list is a read-only replica
  if (isAuthority()) await db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return device;
}

export async function revokeDevice(db: PrismaClient, deviceId: string) {
  // Revocation stops future sync only; nothing on the device is erased remotely (Report 21 §8)
  return db.device.update({ where: { id: deviceId }, data: { status: "REVOKED", revokedAt: new Date() } });
}

/**
 * Execute commands in the order received. An office hub may send `{ relayFor, command }` on behalf of a computer
 * registered to it; the idempotency key is always the computer that created the command.
 */
export async function pushCommands(db: PrismaClient, requester: { id: string; role: string }, items: unknown[]): Promise<{ id: string; outcome: CommandOutcome }[]> {
  if (!Array.isArray(items) || items.length > 200) throw new Error("Send 1-200 commands at a time");
  const out: { id: string; outcome: CommandOutcome }[] = [];
  for (const item of items) {
    const relay = typeof item === "object" && item !== null && "relayFor" in item ? (item as { relayFor: unknown; command: unknown; assignedNumber?: unknown }) : null;
    const raw = relay ? relay.command : item;
    const id = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : "";
    let origin = requester.id;
    if (relay) {
      const source = typeof relay.relayFor === "string" ? await db.device.findUnique({ where: { id: relay.relayFor } }) : null;
      if (requester.role !== "HUB" || !source || source.hubId !== requester.id || source.status !== "ACTIVE") {
        out.push({ id, outcome: { status: "REJECTED", message: "This office server may not send entries for that computer", code: 403 } });
        continue;
      }
      origin = source.id;
    }
    const assigned = relay && typeof relay.assignedNumber === "number" ? { number: relay.assignedNumber, hubId: requester.id } : undefined;
    out.push({ id, outcome: await executeCommand(db, origin, raw, { assigned }) });
  }
  return out;
}

/**
 * Reserve a block of official numbers for an office server (hub). The cloud's own counter moves past the block,
 * so the two can never collide. Unused numbers in a block remain documented gaps (numbering report).
 */
export async function reserveBlock(db: PrismaClient, hubId: string, series: string, size: number) {
  if (!/^[A-Z]{1,5}$/.test(series)) throw new Error("Unknown series");
  if (!Number.isInteger(size) || size < 10 || size > 1000) throw new Error("Block size must be 10-1000");
  return db.$transaction(async (tx) => {
    const current = await tx.documentSeries.findUnique({ where: { series } });
    const from = current?.nextNumber ?? 1;
    const to = from + size - 1;
    await tx.documentSeries.upsert({ where: { series }, create: { series, nextNumber: to + 1 }, update: { nextNumber: to + 1 } });
    await tx.numberBlock.updateMany({ where: { series, deviceId: hubId, status: "ACTIVE" }, data: { status: "EXHAUSTED" } });
    return tx.numberBlock.create({ data: { series, fromNumber: from, toNumber: to, nextNumber: from, deviceId: hubId, status: "ACTIVE" } });
  });
}

/** Withdraw a hub's blocks (e.g. the office server is retired); unused numbers become documented gaps. */
export async function releaseBlocks(db: PrismaClient, hubId: string) {
  return db.numberBlock.updateMany({ where: { deviceId: hubId, status: { not: "RELEASED" } }, data: { status: "RELEASED" } });
}

/**
 * An office server failed or is retired (Report 23 §4.3): its computers are moved to another office server, or to
 * the cloud directly (`toHubId` null). Its unused reserved numbers are released. Entries it held but had not yet
 * forwarded are still on the office computers (status "sent to office server") and are sent again from there.
 */
export async function moveDevices(db: PrismaClient, fromHubId: string, toHubId: string | null) {
  const from = await db.device.findUnique({ where: { id: fromHubId } });
  if (!from || from.role !== "HUB") throw new Error("Unknown office server");
  if (toHubId !== null) {
    const to = await db.device.findUnique({ where: { id: toHubId } });
    if (!to || to.role !== "HUB" || to.status !== "ACTIVE" || to.id === fromHubId) throw new Error("Choose another active office server");
  }
  const moved = await db.device.updateMany({ where: { hubId: fromHubId }, data: { hubId: toHubId } });
  const released = await releaseBlocks(db, fromHubId);
  return { moved: moved.count, releasedBlocks: released.count };
}

export interface Change {
  seq: number;
  tbl: string;
  rowId: string;
  op: "I" | "U" | "D";
  row: Record<string, WireValue> | null;
}

/**
 * Changes after `since`, one entry per changed row carrying its current content, ordered by the row's first
 * change in the window (so a parent always precedes rows that reference it).
 */
export async function pullChanges(db: PrismaClient, since: number, limit = 500): Promise<{ changes: Change[]; lastSeq: number; more: boolean; epoch: SyncEpoch }> {
  return db.$transaction(async (tx) => {
    const log = (await tx.$queryRawUnsafe(`SELECT seq, tbl, rowId, op FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?`, since, limit + 1)) as { seq: number | bigint; tbl: string; rowId: string; op: string }[];
    const more = log.length > limit;
    const window = log.slice(0, limit);
    const lastSeq = window.length ? Number(window[window.length - 1].seq) : since;
    const firstSeen = new Map<string, Change>();
    for (const l of window) {
      const key = `${l.tbl}|${l.rowId}`;
      const existing = firstSeen.get(key);
      if (existing) existing.op = l.op === "D" ? "D" : existing.op === "D" ? "I" : existing.op;
      else firstSeen.set(key, { seq: Number(l.seq), tbl: l.tbl, rowId: l.rowId, op: l.op as Change["op"], row: null });
    }
    for (const c of firstSeen.values()) {
      const table = TABLE_BY_NAME.get(c.tbl);
      if (!table) continue;
      const rows = (await tx.$queryRawUnsafe(`SELECT * FROM "${table.name}" WHERE "${table.key}" = ?`, c.rowId)) as Record<string, unknown>[];
      if (rows[0]) c.row = encodeRow(rows[0]);
      else c.op = "D";
    }
    return { changes: [...firstSeen.values()].filter((c) => TABLE_BY_NAME.has(c.tbl)), lastSeq, more, epoch: await syncEpoch(tx) };
  });
}

/**
 * This node's synchronisation epoch. It changes only when the node's database is restored from a backup; computers
 * that sync from it see the change, send their recent entries again and resynchronise (Report 23 §5).
 */
export interface SyncEpoch {
  id: string;
  backupCreatedAt?: string;
}

export async function syncEpoch(db: Pick<PrismaClient, "nodeState">): Promise<SyncEpoch> {
  const row = await db.nodeState.findUnique({ where: { key: "SYNC_EPOCH" } });
  return row ? (JSON.parse(row.value) as SyncEpoch) : { id: "initial" };
}

export async function setSyncEpoch(db: Pick<PrismaClient, "nodeState">, epoch: SyncEpoch) {
  const value = JSON.stringify(epoch);
  await db.nodeState.upsert({ where: { key: "SYNC_EPOCH" }, create: { key: "SYNC_EPOCH", value }, update: { value } });
}

/** Consistent full copy for a new or rebuilt replica, with the change-log position it corresponds to. */
export async function snapshot(db: PrismaClient): Promise<{ atSeq: number; tables: { name: string; rows: Record<string, WireValue>[] }[]; epoch: SyncEpoch }> {
  return db.$transaction(async (tx) => {
    const max = (await tx.$queryRawUnsafe(`SELECT COALESCE(MAX(seq), 0) AS m FROM change_log`)) as { m: number | bigint }[];
    const tables = [];
    for (const t of REPLICATED_TABLES) {
      const rows = (await tx.$queryRawUnsafe(`SELECT * FROM "${t.name}"`)) as Record<string, unknown>[];
      tables.push({ name: t.name, rows: rows.map(encodeRow) });
    }
    return { atSeq: Number(max[0].m), tables, epoch: await syncEpoch(tx) };
  }, { timeout: 120_000 });
}
