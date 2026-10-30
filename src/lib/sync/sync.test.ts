// Phase 3: automatic synchronisation between devices and the ledger authority (Report 21).
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createPurchaseInvoice, createSaleInvoice, accountBalance } from "@/lib/accounting/posting";
import { trialBalance, stockReport } from "@/lib/accounting/queries";
import { toPlain } from "@/lib/domain/decimal";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations } from "@/lib/tenancy/migrate";
import { submitCommand, Preview } from "./outbox";
import { registerDevice, authenticateDevice, revokeDevice, pushCommands, pullChanges, snapshot, SyncAuthError } from "./server";
import { syncOnce, backoffMs, Transport, NetworkError } from "./worker";
import { checkProtocol, SYNC_PROTOCOL, MIN_SYNC_PROTOCOL } from "./commands";
import { billPayments } from "@/lib/accounting/payables";
import { invoicePayments } from "@/lib/accounting/receivables";
import { UpstreamRefused } from "./http-transport";

let cloud: PrismaClient;
let cleanup: () => Promise<void>;
let dir: string;
const id: Record<string, string> = {};

/** In-process transport to the cloud with switchable failures. */
function transportFor(deviceId: string, state: { online: boolean; loseNextResponse?: boolean }): Transport {
  return {
    upstreamId: "cloud",
    async push(commands) {
      if (!state.online) throw new NetworkError("offline");
      const result = await pushCommands(cloud, { id: deviceId, role: "DEVICE" }, commands);
      if (state.loseNextResponse) {
        state.loseNextResponse = false;
        throw new NetworkError("connection dropped after the server processed the request");
      }
      return result;
    },
    async pull(since) {
      if (!state.online) throw new NetworkError("offline");
      return pullChanges(cloud, since, 50);
    },
    async snapshot() {
      if (!state.online) throw new NetworkError("offline");
      return snapshot(cloud);
    },
  };
}

async function newDevice(name: string) {
  const { device } = await registerDevice(cloud, { name, role: "DEVICE", registeredById: id.admin });
  const file = `file:${path.join(dir, `${device.code}.db`).replace(/\\/g, "/")}`;
  await applyMigrations(file);
  const db = createPrismaClient(file, undefined);
  const state = { online: true, loseNextResponse: false };
  return { device, db, state, transport: transportFor(device.id, state), local: { id: device.id, code: device.code } };
}

const sale = (actor: string, qty: number, price = 1250) => ({
  type: "CREATE_DOCUMENT", actorUserId: actor, docType: "SALE_INVOICE",
  input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: qty, unit: "packet", unitPrice: price }] },
});
beforeAll(async () => {
  const t = await createTestDb();
  ({ cleanup, dir } = t);
  cloud = t.db;
  id.clerk = (await cloud.user.create({ data: { name: "Clerk", email: "clerk@t.local", password: "x", role: "EMPLOYEE" } })).id;
  id.clerk2 = (await cloud.user.create({ data: { name: "Clerk 2", email: "clerk2@t.local", password: "x", role: "EMPLOYEE" } })).id;
  id.store = (await cloud.user.create({ data: { name: "Store", email: "store@t.local", password: "x", role: "INVENTORY_MANAGER" } })).id;
  id.admin = (await cloud.user.create({ data: { name: "Admin", email: "admin@t.local", password: "x", role: "ADMIN" } })).id;
  id.admin2 = (await cloud.user.create({ data: { name: "Admin 2", email: "admin2@t.local", password: "x", role: "ADMIN" } })).id;
  const cat = await cloud.componentCategory.create({ data: { name: "Paper" } });
  const paper = await cloud.component.create({ data: { sku: "P1", name: "Paper", categoryId: cat.id } });
  await cloud.itemUnitProfile.create({ data: { componentId: paper.id, kind: "PAPER", baseUnit: "sheet", confirmed: true, conversions: { create: [{ code: "packet", factor: "100" }] } } });
  id.paper = paper.id;
  for (const [k, kind, sub] of [["customer", "PARTY", "CUSTOMER"], ["supplier", "PARTY", "SUPPLIER"]]) {
    id[k] = (await cloud.ledgerAccount.create({ data: { code: k.toUpperCase(), name: k, kind, subType: sub } })).id;
  }
  await createPurchaseInvoice(cloud, { id: id.store, role: "INVENTORY_MANAGER" }, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.paper, quantity: 20, unit: "packet", unitPrice: 1250 }] });
});
afterAll(async () => {
  await cleanup?.();
});
describe("device credentials", () => {
  it("authenticates only an active device with its exact secret", async () => {
    const { device, secret } = await registerDevice(cloud, { name: "Counter PC", role: "DEVICE", registeredById: id.admin });
    expect((await authenticateDevice(cloud, `${device.id}.${secret}`)).id).toBe(device.id);
    await expect(authenticateDevice(cloud, `${device.id}.wrong`)).rejects.toBeInstanceOf(SyncAuthError);
    await expect(authenticateDevice(cloud, null)).rejects.toBeInstanceOf(SyncAuthError);
    await revokeDevice(cloud, device.id);
    await expect(authenticateDevice(cloud, `${device.id}.${secret}`)).rejects.toThrow(/revoked/);
    const stored = await cloud.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(stored.secretHash).not.toContain(secret);
});
  it("backoff grows exponentially with jitter and is capped", () => {
    expect([backoffMs(1, () => 0.5), backoffMs(2, () => 0.5), backoffMs(3, () => 0.5)]).toEqual([5000, 10000, 20000]);
    expect(backoffMs(30, () => 0.5)).toBe(30 * 60_000);
  });
});
describe("offline work, then automatic sync", () => {
  it("a new device downloads a full copy, works offline, and syncs exactly once when back online", async () => {
    const d = await newDevice("Shop PC");
    const first = await syncOnce(d.db, d.transport);
    expect(first.error).toBeUndefined();
    expect(await d.db.user.count()).toBe(await cloud.user.count());
    expect((await stockReport(d.db, { locationCode: "MAIN" })).rows[0].onHand).toBe("2000");

    d.state.online = false;
    const a = await submitCommand(d.db, d.local, sale(id.clerk, 3));
    const b = await submitCommand(d.db, d.local, sale(id.clerk, 2));
    const offline = await syncOnce(d.db, d.transport);
    expect(offline.error).toMatch(/No connection/);
    const failed = await d.db.outboxCommand.findMany({ orderBy: { seq: "asc" } });
    expect(failed.map((r) => [r.status, r.attempts])).toEqual([["FAILED_RETRY", 1], ["FAILED_RETRY", 1]]);
    expect(failed[0].nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    d.state.online = true;
    const later = new Date(Date.now() + 60 * 60_000); // after the backoff
    const online = await syncOnce(d.db, d.transport, later);
    expect([online.accepted, online.needsReview, online.error]).toEqual([2, 0, undefined]);
    const synced = await d.db.outboxCommand.findMany({ orderBy: { seq: "asc" } });
    expect(synced.map((r) => r.status)).toEqual(["SYNCED", "SYNCED"]);
    const results = synced.map((r) => JSON.parse(r.result!));
    expect(results.map((r) => r.docNo)).toEqual(["SI-0001", "SI-0002"]); // official numbers from the authority
    // The preview the user saw offline equals what the authority posted
    const central = await cloud.accountingDocument.findUniqueOrThrow({ where: { commandId: a.id } });
    expect((JSON.parse(a.preview!) as Preview).total).toBe(central.total);
    // The replica now holds the official documents and balances; nothing pending remains
    const replicaDoc = await d.db.accountingDocument.findUniqueOrThrow({ where: { commandId: b.id } });
    expect([replicaDoc.docNo, replicaDoc.originDeviceId]).toEqual(["SI-0002", d.device.id]);
    expect(toPlain(await accountBalance(d.db, id.customer))).toBe(toPlain(await accountBalance(cloud, id.customer)));
    expect((await stockReport(d.db, { locationCode: "MAIN" })).rows[0].onHand).toBe("1500");
    id.si1 = central.id;
  });

  it("entries that failed while offline go through in the first cycle after the connection returns", async () => {
    const d = await newDevice("Quick PC");
    await syncOnce(d.db, d.transport);
    d.state.online = false;
    const cmd = await submitCommand(d.db, d.local, sale(id.clerk, 1));
    await syncOnce(d.db, d.transport);
    await syncOnce(d.db, d.transport);
    const waiting = await d.db.outboxCommand.findUniqueOrThrow({ where: { id: cmd.id } });
    expect([waiting.status, waiting.attempts]).toEqual(["FAILED_RETRY", 1]); // second cycle respected the backoff
    d.state.online = true;
    const back = await syncOnce(d.db, d.transport); // no waiting for the backoff timer
    expect([back.accepted, (await d.db.outboxCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status]).toEqual([1, "SYNCED"]);
  });

  it("entries keep their order: a newer entry never overtakes one waiting for its retry (D-010)", async () => {
    const d = await newDevice("Order PC");
    await syncOnce(d.db, d.transport);
    d.state.online = false;
    const first = await submitCommand(d.db, d.local, sale(id.clerk, 1));
    await syncOnce(d.db, d.transport); // first now waits on its backoff timer
    const second = await submitCommand(d.db, d.local, sale(id.clerk, 1));
    d.state.online = true;
    await syncOnce(d.db, d.transport);
    const [a, b] = await Promise.all([first, second].map((c) => cloud.accountingDocument.findUniqueOrThrow({ where: { commandId: c.id } })));
    expect(a.number).toBeLessThan(b.number);
  });

  it("a pending entry whose posted result already reached this copy is counted once (D-011)", async () => {
    const d = await newDevice("Overlay PC");
    await syncOnce(d.db, d.transport);
    const cmd = await submitCommand(d.db, d.local, sale(id.clerk, 2));
    // The entry reaches the server by another route (e.g. an office hub) and the result is copied here
    // before this computer has marked its own entry as synced
    await pushCommands(cloud, { id: d.device.id, role: "DEVICE" }, [JSON.parse(cmd.payload)]);
    const cursor = (await d.db.syncCursor.findFirstOrThrow()).lastSeq;
    const { applyChanges } = await import("./replica");
    const feed = await pullChanges(cloud, cursor, 1000);
    await applyChanges(d.db, "cloud", feed.changes, feed.lastSeq);
    expect((await d.db.outboxCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe("PENDING_SYNC");
    const confirmed = (await stockReport(d.db, { locationCode: "MAIN" })).rows[0].onHand;
    const { speculate } = await import("./outbox");
    const overlay = await speculate(d.db, d.local, async (tx) => (await stockReport(tx as unknown as PrismaClient, { locationCode: "MAIN" })).rows[0].onHand);
    expect(overlay).toBe(confirmed);
  });

  it("a lost response or a crash mid-push never duplicates an invoice", async () => {
    const d = await newDevice("Back office PC");
    await syncOnce(d.db, d.transport);
    const cmd = await submitCommand(d.db, d.local, sale(id.clerk, 1));
    d.state.loseNextResponse = true;
    const lost = await syncOnce(d.db, d.transport);
    expect(lost.error).toMatch(/dropped/);
    expect((await d.db.outboxCommand.findUniqueOrThrow({ where: { id: cmd.id } })).status).toBe("FAILED_RETRY");
    // Simulate a crash while the command was being sent
    await d.db.outboxCommand.update({ where: { id: cmd.id }, data: { status: "SYNCING" } });
    const retry = await syncOnce(d.db, d.transport, new Date(Date.now() + 3_600_000));
    expect(retry.accepted).toBe(1);
    expect(await cloud.accountingDocument.count({ where: { commandId: cmd.id } })).toBe(1);
    expect(await cloud.syncInbox.count({ where: { commandId: cmd.id } })).toBe(1);
    // Replaying the exact command again returns the stored result
    const replay = await pushCommands(cloud, { id: d.device.id, role: "DEVICE" }, [JSON.parse((await d.db.outboxCommand.findUniqueOrThrow({ where: { id: cmd.id } })).payload)]);
    expect(replay[0].outcome.status).toBe("ACCEPTED");
    expect(await cloud.accountingDocument.count({ where: { commandId: cmd.id } })).toBe(1);
    // The same id with different content is a conflict, never a second posting
    const tampered = { ...JSON.parse((await d.db.outboxCommand.findUniqueOrThrow({ where: { id: cmd.id } })).payload), input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: 9, unit: "packet", unitPrice: 1 }] } };
    expect((await pushCommands(cloud, { id: d.device.id, role: "DEVICE" }, [tampered]))[0].outcome.status).toBe("CONFLICT");
  });

  it("two devices cancelling the same invoice offline: one succeeds, the other is flagged for review", async () => {
    const d1 = await newDevice("PC A");
    const d2 = await newDevice("PC B");
    await syncOnce(d1.db, d1.transport);
    await syncOnce(d2.db, d2.transport);
    d1.state.online = false;
    d2.state.online = false;
    const docId = id.si1;
    const c1 = await submitCommand(d1.db, d1.local, { type: "DOCUMENT_ACTION", actorUserId: id.admin, action: "cancel", reason: "Wrong customer", target: { id: docId }, expect: { status: "POSTED" } });
    const c2 = await submitCommand(d2.db, d2.local, { type: "DOCUMENT_ACTION", actorUserId: id.admin2, action: "cancel", reason: "Duplicate", target: { id: docId }, expect: { status: "POSTED" } });
    d1.state.online = true;
    d2.state.online = true;
    expect((await syncOnce(d1.db, d1.transport)).accepted).toBe(1);
    const second = await syncOnce(d2.db, d2.transport);
    expect(second.needsReview).toBe(1);
    const flagged = await d2.db.outboxCommand.findUniqueOrThrow({ where: { id: c2.id } });
    expect([flagged.status, flagged.lastError]).toEqual(["NEEDS_REVIEW", "Changed elsewhere: it is now cancelled, not posted"]);
    // The original entry is kept for the user to resolve; the books show one cancellation
    expect(await cloud.journalEntry.count({ where: { documentId: docId, kind: "REVERSAL" } })).toBe(1);
    expect((await d2.db.accountingDocument.findUniqueOrThrow({ where: { id: docId } })).status).toBe("CANCELLED");
    void c1;
  });

  it("dependent entries sync in order; a role removed before sync rejects the entry and its dependants", async () => {
    const d = await newDevice("Store PC");
    await syncOnce(d.db, d.transport);
    d.state.online = false;
    const issue = await submitCommand(d.db, d.local, { type: "CREATE_DOCUMENT", actorUserId: id.store, docType: "STOCK_ISSUE", input: { date: "2026-10-22", reason: "INTERNAL_CONSUMPTION", remarks: "Office", lines: [{ componentId: id.paper, quantity: 10 }] } });
    const approve = await submitCommand(d.db, d.local, { type: "DOCUMENT_ACTION", actorUserId: id.admin, action: "approve", target: { commandRef: issue.id } });
    const sale2 = await submitCommand(d.db, d.local, sale(id.clerk2, 1));
    const sale2Approval = await submitCommand(d.db, d.local, { type: "DOCUMENT_ACTION", actorUserId: id.admin, action: "cancel", reason: "test", target: { commandRef: sale2.id } });
    // While the device was offline, the second clerk left the business
    await cloud.user.update({ where: { id: id.clerk2 }, data: { isActive: false } });
    d.state.online = true;
    const r = await syncOnce(d.db, d.transport);
    const rows = Object.fromEntries((await d.db.outboxCommand.findMany()).map((x) => [x.id, x]));
    expect([rows[issue.id].status, rows[approve.id].status]).toEqual(["SYNCED", "SYNCED"]);
    expect([rows[sale2.id].status, rows[sale2Approval.id].status]).toEqual(["NEEDS_REVIEW", "NEEDS_REVIEW"]);
    expect(rows[sale2.id].lastError).toMatch(/no longer active/);
    expect(rows[sale2Approval.id].lastError).toMatch(/Depends on an entry that needs review/);
    const central = await cloud.accountingDocument.findUniqueOrThrow({ where: { commandId: issue.id } });
    expect([central.status, central.approvedById]).toEqual(["POSTED", id.admin]);
    expect(r.accepted).toBe(2);
  });

  it("after everything syncs, every replica agrees with the authority and the books balance", async () => {
    const d = await newDevice("Audit PC");
    await syncOnce(d.db, d.transport);
    // An online entry made at the cloud reaches existing devices on their next cycle
    await createSaleInvoice(cloud, { id: id.clerk, role: "EMPLOYEE" }, { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: 1, unit: "packet", unitPrice: 1300 }] });
    const r = await syncOnce(d.db, d.transport);
    expect(r.pulled).toBeGreaterThan(0);
    const [ct, dt] = [await trialBalance(cloud), await trialBalance(d.db)];
    expect(dt.balanced).toBe(true);
    expect(dt.rows.map((x) => [x.code, x.debit, x.credit])).toEqual(ct.rows.map((x) => [x.code, x.debit, x.credit]));
    expect((await stockReport(d.db, {})).rows.map((x) => x.onHand)).toEqual((await stockReport(cloud, {})).rows.map((x) => x.onHand));
    expect(await d.db.journalLine.count()).toBe(await cloud.journalLine.count());
  });
});
describe("upgrades (Report 26 Phase 9)", () => {
  it("a computer on an incompatible protocol is refused before any entry is read, so its entries stay queued", async () => {
    // Computers from before the header existed speak version 1, which protocol 2 (Report 30) no longer accepts
    expect(checkProtocol(null)).toMatchObject({ status: 426, code: "CLIENT_TOO_OLD" });
    expect(checkProtocol(String(SYNC_PROTOCOL))).toBeNull();
    expect(checkProtocol(String(SYNC_PROTOCOL + 1))).toMatchObject({ status: 409, code: "SERVER_TOO_OLD" });
    expect(checkProtocol(String(MIN_SYNC_PROTOCOL - 1))).toMatchObject({ status: 426, code: "CLIENT_TOO_OLD" });
    expect(checkProtocol("garbage")).toMatchObject({ status: 426 });
    // A refused push leaves every entry on the computer, waiting
    const d = await newDevice("Not yet updated PC");
    await syncOnce(d.db, d.transport);
    const e = await submitCommand(d.db, d.local, sale(id.clerk, 1));
    const refusing: Transport = { ...d.transport, push: async () => { throw new UpstreamRefused("The server runs an older version than this computer; entries are kept until it is updated"); } };
    const r = await syncOnce(d.db, refusing);
    expect(r.error).toMatch(/older version/);
    const row = await d.db.outboxCommand.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe("FAILED_RETRY");
    expect(await cloud.syncInbox.count({ where: { commandId: e.id } })).toBe(0); // nothing recorded as rejected
  });
});
describe("Sales and Purchases screens offline (protocol 2, Report 30)", () => {
  it("a purchase bill with part paid now, a later supplier payment for it, a sale and a receipt: entered offline, posted once", async () => {
    const supplier = await cloud.supplier.create({ data: { name: "Offline Mill", phone: "0300-9990000" } });
    const customer = await cloud.customer.create({ data: { name: "Offline Customer" } });
    const d = await newDevice("Godown PC");
    await syncOnce(d.db, d.transport);
    // Suppliers and customers come with the copy, so the screens can use them offline
    expect([await d.db.supplier.count({ where: { id: supplier.id } }), await d.db.customer.count({ where: { id: customer.id } })]).toEqual([1, 1]);

    d.state.online = false;
    const bill = await submitCommand(d.db, d.local, {
      type: "SCREEN_PURCHASE", actorUserId: id.admin,
      input: { date: "2026-10-23", supplierId: supplier.id, vendorBillNo: "OM-1", items: [{ componentId: id.paper, quantity: 10, unit: "packet", unitPrice: "1000.50" }], paidNow: { amount: "3000", method: "CASH" } },
    });
    expect((JSON.parse(bill.preview!) as Preview).total).toBe("10005");
    // A later payment for that same bill, made before anything was synced, refers to it by its entry
    const pay = await submitCommand(d.db, d.local, {
      type: "PAY_SUPPLIER", actorUserId: id.admin,
      input: { supplierId: supplier.id, date: "2026-10-24", amount: "2005", method: "BANK_TRANSFER", reference: "TT-9", allocations: [{ bill: { commandRef: bill.id }, amount: "2005" }] },
    });
    const sold = await submitCommand(d.db, d.local, {
      type: "SCREEN_SALE", actorUserId: id.clerk,
      input: { date: "2026-10-24", customerId: customer.id, items: [{ componentId: id.paper, quantity: 2, unit: "packet", unitPrice: 1500 }], paidNow: { amount: "1000", method: "CASH" } },
    });
    const got = await submitCommand(d.db, d.local, {
      type: "RECEIVE_PAYMENT", actorUserId: id.clerk,
      input: { customerId: customer.id, date: "2026-10-25", amount: "2000", method: "CASH", allocations: [{ invoice: { commandRef: sold.id }, amount: "2000" }] },
    });
    expect([bill, pay, sold, got].map((e) => e.provisionalRef?.startsWith(`P-${d.device.code}-`))).toEqual([true, true, true, true]);

    // Back online; the first answer is lost on the way, so everything is sent twice
    d.state.online = true;
    d.state.loseNextResponse = true;
    await syncOnce(d.db, d.transport);
    const r = await syncOnce(d.db, d.transport, new Date(Date.now() + 3_600_000));
    expect(r.needsReview).toBe(0);
    expect((await d.db.outboxCommand.findMany({ where: { id: { in: [bill.id, pay.id, sold.id, got.id] } } })).map((e) => e.status)).toEqual(["SYNCED", "SYNCED", "SYNCED", "SYNCED"]);

    const pi = await cloud.accountingDocument.findUniqueOrThrow({ where: { commandId: bill.id } });
    const p = await billPayments(cloud, pi.id);
    expect([pi.docNo.startsWith("PI-"), pi.total, p.paid, p.remaining, p.status, p.payments.map((x) => x.docNo.slice(0, 3))]).toEqual([true, "10005", "5005", "5000", "PARTIALLY_PAID", ["CPV", "BPV"]]);
    const si = await cloud.accountingDocument.findUniqueOrThrow({ where: { commandId: sold.id } });
    const i = await invoicePayments(cloud, si.id);
    expect([si.total, i.paid, i.status]).toEqual(["3000", "3000", "PAID"]);
    // Exactly once: one bill, one payment of each kind, one sale, one receipt for these entries
    expect(await cloud.accountingDocument.count({ where: { commandId: { in: [bill.id, `${bill.id}:paid`, pay.id, sold.id, `${sold.id}:paid`, got.id] } } })).toBe(6);
    expect(await cloud.syncInbox.count({ where: { commandId: { in: [bill.id, pay.id, sold.id, got.id] } } })).toBe(4);
    // The computer's copy now holds the official bill with its payments, and the books still balance
    expect((await d.db.accountingDocument.findUniqueOrThrow({ where: { commandId: bill.id } })).docNo).toBe(pi.docNo);
    expect((await billPayments(d.db, pi.id)).remaining).toBe("5000");
    expect((await trialBalance(cloud)).balanced).toBe(true);
  });

  it("offline entries are checked against the server's rules and roles when they arrive", async () => {
    const supplier = await cloud.supplier.findFirstOrThrow({ where: { name: "Offline Mill" } });
    const d = await newDevice("Store PC");
    await syncOnce(d.db, d.transport);
    // Store staff may enter a bill but not pay a supplier: refused on this computer already
    await expect(submitCommand(d.db, d.local, {
      type: "PAY_SUPPLIER", actorUserId: id.store, input: { supplierId: supplier.id, date: "2026-10-26", amount: "10", method: "CASH", allocations: [] },
    })).rejects.toThrow(/not allowed/);
    // Paying more than a bill owes is refused here too, before it is queued
    const pi = await cloud.accountingDocument.findFirstOrThrow({ where: { type: "PURCHASE_INVOICE", vendorBillNo: "OM-1" } });
    await expect(submitCommand(d.db, d.local, {
      type: "PAY_SUPPLIER", actorUserId: id.admin, input: { supplierId: supplier.id, date: "2026-10-26", amount: "9000", method: "CASH", allocations: [{ bill: { id: pi.id }, amount: "9000" }] },
    })).rejects.toThrow(/only 5000 is still payable/);
  });
});
