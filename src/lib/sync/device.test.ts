// Phase 2: single-device offline operation on an isolated replica (Report 21 §2).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createClient } from "@libsql/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createPurchaseInvoice, accountBalance } from "@/lib/accounting/posting";
import { stockReport } from "@/lib/accounting/queries";
import { ensureAccountingSetup } from "@/lib/accounting/setup";
import { toPlain } from "@/lib/domain/decimal";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations } from "@/lib/tenancy/migrate";
import { submitCommand, speculate, cancelPending, OutboxError, Preview } from "./outbox";
import { protectSecret, unprotectSecret, dpapiAvailable } from "../device/secrets";

let cloud: PrismaClient;
let device: PrismaClient;
let cleanup: () => Promise<void>;
let dir: string;
let deviceFile: string;
const id: Record<string, string> = {};
const dev = { id: "dev-1", code: "D01" };

const ledgerCounts = async (db: PrismaClient) => ({
  docs: await db.accountingDocument.count(), journal: await db.journalLine.count(), moves: await db.stockMovement.count(),
});

beforeAll(async () => {
  const t = await createTestDb();
  ({ cleanup, dir } = t);
  cloud = t.db;
  id.clerk = (await cloud.user.create({ data: { name: "Clerk", email: "clerk@t.local", password: "x", role: "EMPLOYEE" } })).id;
  id.store = (await cloud.user.create({ data: { name: "Store", email: "store@t.local", password: "x", role: "INVENTORY_MANAGER" } })).id;
  id.admin = (await cloud.user.create({ data: { name: "Admin", email: "admin@t.local", password: "x", role: "ADMIN" } })).id;
  const cat = await cloud.componentCategory.create({ data: { name: "Paper" } });
  const paper = await cloud.component.create({ data: { sku: "P1", name: "Paper", categoryId: cat.id } });
  await cloud.itemUnitProfile.create({ data: { componentId: paper.id, kind: "PAPER", baseUnit: "sheet", confirmed: true, conversions: { create: [{ code: "packet", factor: "100" }] } } });
  id.paper = paper.id;
  for (const [k, kind, sub] of [["customer", "PARTY", "CUSTOMER"], ["supplier", "PARTY", "SUPPLIER"], ["cash", "CASH_BANK", "CASH"]]) {
    id[k] = (await cloud.ledgerAccount.create({ data: { code: k.toUpperCase(), name: k, kind, subType: sub } })).id;
  }
  await createPurchaseInvoice(cloud, { id: id.store, role: "INVENTORY_MANAGER" }, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.paper, quantity: 10, unit: "packet", unitPrice: 1250 }] });
  // First sync of a device = a consistent snapshot of the tenant database (Report 21 §4.1)
  deviceFile = path.join(dir, "device.db").replace(/\\/g, "/");
  await cloud.$executeRawUnsafe(`VACUUM INTO '${deviceFile}'`);
  device = createPrismaClient(`file:${deviceFile}`, undefined);
});

afterAll(async () => {
  await device?.$disconnect();
  await cleanup?.();
});

const sale = (qty: number, loose = 0, price = 1250) => ({
  type: "CREATE_DOCUMENT", actorUserId: id.clerk, docType: "SALE_INVOICE",
  input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: qty, unit: "packet", loose, unitPrice: price }] },
});

describe("offline entry on one device", () => {
  it("queues a sale durably with a server-identical preview and posts nothing locally", async () => {
    const before = await ledgerCounts(device);
    const row = await submitCommand(device, dev, sale(3, 25));
    expect([row.status, row.provisionalRef, row.seq]).toEqual(["PENDING_SYNC", "P-D01-00001", 1]);
    const p = JSON.parse(row.preview!) as Preview;
    expect([p.exactTotal, p.total, p.roundingAdjustment, p.previousBalance, p.newBalance]).toEqual(["4062.5", "4062", "-0.5", "0", "4062"]);
    expect(p.lines?.[0].baseQuantity).toBe("325");
    expect(await ledgerCounts(device)).toEqual(before); // the device never posts to its ledger
  });

  it("each preview stacks on the device's earlier pending entries (balances and stock)", async () => {
    const row = await submitCommand(device, dev, sale(7, 0));
    const p = JSON.parse(row.preview!) as Preview;
    expect([p.previousBalance, p.newBalance]).toEqual(["4062", "12812"]);
    const over = JSON.parse((await submitCommand(device, dev, sale(1, 0))).preview!) as Preview;
    // 1000 - 325 - 700 = -25 after this sale: allowed with a warning under the default policy (OD-04)
    expect(over.hasNegativeStock).toBe(true);
    expect(over.lines?.[0].stockWarning).toMatch(/below zero/);
  });

  it("the pending overlay is visible on request and invisible in the confirmed view", async () => {
    const confirmed = (await stockReport(device, { locationCode: "MAIN" })).rows.find((r) => r.componentId === id.paper)!;
    const withPending = await speculate(device, dev, async (tx) => (await stockReport(tx as unknown as PrismaClient, { locationCode: "MAIN" })).rows.find((r) => r.componentId === id.paper)!);
    expect([confirmed.onHand, withPending.onHand]).toEqual(["1000", "-125"]);
    const bal = await speculate(device, dev, async (tx) => toPlain(await accountBalance(tx, id.customer)));
    expect([toPlain(await accountBalance(device, id.customer)), bal]).toEqual(["0", "14062"]);
  });

  it("refuses entries the server would refuse for their content, without queuing them", async () => {
    const before = await device.outboxCommand.count();
    await expect(submitCommand(device, dev, { ...sale(1), input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: "1.5", unit: "packet", unitPrice: 1 }] } })).rejects.toThrow(/whole numbers/);
    await expect(submitCommand(device, dev, { ...sale(1), actorUserId: id.store })).rejects.toThrow(/not allowed/); // INVENTORY_MANAGER cannot sell
    await expect(submitCommand(device, dev, { type: "CREATE_DOCUMENT", actorUserId: id.clerk, docType: "NOPE", input: {} })).rejects.toBeInstanceOf(OutboxError);
    expect(await device.outboxCommand.count()).toBe(before);
  });

  it("dependent entries: an approval refers to an offline stock issue; withdrawing the issue withdraws the approval", async () => {
    const issue = await submitCommand(device, dev, { type: "CREATE_DOCUMENT", actorUserId: id.store, docType: "STOCK_ISSUE", input: { date: "2026-10-22", reason: "INTERNAL_CONSUMPTION", remarks: "Office", lines: [{ componentId: id.paper, quantity: 10 }] } });
    expect((JSON.parse(issue.preview!) as Preview).status).toBe("PENDING_APPROVAL");
    await expect(submitCommand(device, dev, { type: "DOCUMENT_ACTION", actorUserId: id.store, action: "approve", target: { commandRef: issue.id } })).rejects.toThrow(/not allowed/);
    const approve = await submitCommand(device, dev, { type: "DOCUMENT_ACTION", actorUserId: id.admin, action: "approve", target: { commandRef: issue.id } });
    expect([approve.dependsOn, (JSON.parse(approve.preview!) as Preview).outcome]).toEqual([issue.id, "ACCEPTED"]);
    const withdrawn = await cancelPending(device, issue.id, "Entered on the wrong computer");
    expect(withdrawn).toEqual([issue.id, approve.id]);
    expect((await device.outboxCommand.findUniqueOrThrow({ where: { id: approve.id } })).status).toBe("CANCELLED");
  });

  it("survives closing and reopening the application (new process, same file)", async () => {
    const before = await device.outboxCommand.findMany({ orderBy: { seq: "asc" } });
    await device.$disconnect();
    device = createPrismaClient(`file:${deviceFile}`, undefined);
    const after = await device.outboxCommand.findMany({ orderBy: { seq: "asc" } });
    expect(after.map((r) => [r.id, r.status, r.preview])).toEqual(before.map((r) => [r.id, r.status, r.preview]));
  });
});

describe("crash safety", () => {
  it("a process killed in the middle of entering sales loses no committed entry and leaves a consistent database", async () => {
    const crashFile = path.join(dir, "crash.db").replace(/\\/g, "/");
    await cloud.$executeRawUnsafe(`VACUUM INTO '${crashFile}'`);
    const c = createClient({ url: `file:${crashFile}` });
    await c.execute("PRAGMA journal_mode=WAL");
    c.close();
    const bootstrap = path.resolve("scripts/tsx-windows-child-bootstrap.cjs");
    const child = spawn(process.execPath, [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      "src/lib/sync/crash-child.ts", crashFile, id.clerk, id.customer, id.paper,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      // tsx starts another Node process; NODE_OPTIONS carries the bootstrap into that process too.
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(bootstrap)}`.trim() },
    });
    const committed: number[] = [];
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (d: Buffer) => {
        for (const m of d.toString().matchAll(/committed (\d+)/g)) committed.push(Number(m[1]));
        if (committed.length >= 5) { child.kill("SIGKILL"); resolve(); }
      });
      child.on("exit", (code) => (committed.length >= 5 ? resolve() : reject(new Error(`child exited ${code}: ${err}`))));
      setTimeout(() => reject(new Error(`timeout; committed ${committed.length}; ${err}`)), 110_000);
    });
    await new Promise((r) => setTimeout(r, 500));
    const after = createClient({ url: `file:${crashFile}` });
    expect((await after.execute("PRAGMA integrity_check")).rows[0].integrity_check).toBe("ok");
    const rows = (await after.execute("SELECT seq, status, preview FROM outbox_commands ORDER BY seq")).rows;
    const seqs = rows.map((r) => Number(r.seq));
    for (const s of committed) expect(seqs).toContain(s); // every reported commit is on disk
    expect(seqs).toEqual(seqs.map((_, i) => i + 1)); // no gaps, no half-written rows
    for (const r of rows) expect(() => JSON.parse(String(r.preview))).not.toThrow();
    after.close();
  }, 120_000);
});

describe("local data protection", () => {
  it("an encrypted device database opens only with its key", async () => {
    const encFile = `file:${path.join(dir, "enc-device.db").replace(/\\/g, "/")}`;
    const key = "device-key-".padEnd(32, "k");
    await applyMigrations(encFile, { encryptionKey: key });
    const enc = createPrismaClient(encFile, key);
    await ensureAccountingSetup(enc);
    const u = await enc.user.create({ data: { name: "Clerk", email: "c@x", password: "x", role: "ADMIN" } });
    const acct = await enc.ledgerAccount.create({ data: { code: "CA", name: "Cash", kind: "CASH_BANK", subType: "CASH" } });
    const party = await enc.ledgerAccount.create({ data: { code: "PA", name: "Party", kind: "PARTY", subType: "CUSTOMER" } });
    await submitCommand(enc, dev, { type: "CREATE_DOCUMENT", actorUserId: u.id, docType: "VOUCHER", input: { series: "CRV", date: "2026-10-22", debitAccountId: acct.id, creditAccountId: party.id, amount: 500 } });
    await enc.$disconnect();
    const reopened = createPrismaClient(encFile, key);
    expect(await reopened.outboxCommand.count()).toBe(1);
    await reopened.$disconnect();
    const noKey = createPrismaClient(encFile, "");
    await expect(noKey.outboxCommand.count()).rejects.toThrow();
    await noKey.$disconnect();
  });

  it.skipIf(!dpapiAvailable())("DPAPI protects device secrets for this Windows user", async () => {
    const secret = "device-secret-" + Math.random().toString(36).slice(2);
    const protectedB64 = await protectSecret(secret);
    expect(Buffer.from(protectedB64, "base64").toString("latin1")).not.toContain(secret);
    expect(await unprotectSecret(protectedB64)).toBe(secret);
    await expect(unprotectSecret(Buffer.from("not protected").toString("base64"))).rejects.toThrow();
  });
});

void fs;
