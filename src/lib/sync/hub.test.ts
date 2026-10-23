// Phase 4: computers A, B, C in one office with an office hub (Mode A), and fully disconnected (Mode B).
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createPurchaseInvoice } from "@/lib/accounting/posting";
import { trialBalance, stockReport } from "@/lib/accounting/queries";
import { setSetting } from "@/lib/accounting/setup";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations } from "@/lib/tenancy/migrate";
import { submitCommand, speculate, Preview } from "./outbox";
import { registerDevice, pushCommands, pullChanges, snapshot, moveDevices } from "./server";
import { relayCommands, officePending } from "./hub";
import { syncOnce, Transport, NetworkError } from "./worker";

let cloud: PrismaClient;
let cleanup: () => Promise<void>;
let dir: string;
const id: Record<string, string> = {};
const net = { internet: true, lan: true };

async function migrated(name: string) {
  const file = `file:${path.join(dir, name).replace(/\\/g, "/")}`;
  await applyMigrations(file);
  return createPrismaClient(file, undefined);
}

/** The hub talks to the cloud over the internet, as a HUB, forwarding entries for its office computers. */
function hubToCloud(hubId: string): Transport {
  const guard = () => { if (!net.internet) throw new NetworkError("internet down"); };
  return {
    upstreamId: "cloud",
    push: async (items) => { guard(); return pushCommands(cloud, { id: hubId, role: "HUB" }, items); },
    pull: async (since) => { guard(); return pullChanges(cloud, since, 100); },
    snapshot: async () => { guard(); return snapshot(cloud); },
  };
}

/** An office computer talks to the hub over the office network (the hub route checks it belongs to this hub). */
function deviceToHub(hub: PrismaClient, hubId: string, deviceId: string): Transport {
  const guard = async () => {
    if (!net.lan) throw new NetworkError("office network down");
    const d = await hub.device.findUnique({ where: { id: deviceId } });
    if (!d || d.hubId !== hubId) throw new Error("not registered to this office server");
  };
  return {
    upstreamId: "hub",
    push: async (items) => { await guard(); return relayCommands(hub, deviceId, items); },
    pull: async (since) => { await guard(); return pullChanges(hub, since, 100); },
    snapshot: async () => { await guard(); return snapshot(hub); },
    office: async () => { await guard(); return officePending(hub); },
  };
}

let hub: { db: PrismaClient; id: string; t: Transport };
const pcs: Record<string, { db: PrismaClient; local: { id: string; code: string }; t: Transport }> = {};

const sale = (cartons: number) => ({
  type: "CREATE_DOCUMENT", actorUserId: id.clerk, docType: "SALE_INVOICE",
  input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: cartons, unit: "carton", unitPrice: 9000 }] },
});
const overlayStock = async (pc: string) =>
  speculate(pcs[pc].db, pcs[pc].local, async (tx) => (await stockReport(tx as unknown as PrismaClient, { locationCode: "MAIN" })).rows.find((r) => r.componentId === id.cups)!.onHand);

beforeAll(async () => {
  const t = await createTestDb();
  ({ cleanup, dir } = t);
  cloud = t.db;
  id.clerk = (await cloud.user.create({ data: { name: "Clerk", email: "clerk@t.local", password: "x", role: "EMPLOYEE" } })).id;
  id.admin = (await cloud.user.create({ data: { name: "Admin", email: "admin@t.local", password: "x", role: "ADMIN" } })).id;
  const cat = await cloud.componentCategory.create({ data: { name: "Cups" } });
  const cups = await cloud.component.create({ data: { sku: "C1", name: "Paper cup", categoryId: cat.id } });
  await cloud.itemUnitProfile.create({ data: { componentId: cups.id, kind: "PIECE", baseUnit: "piece", confirmed: true, conversions: { create: [{ code: "carton", factor: "2000" }] } } });
  id.cups = cups.id;
  for (const [k, sub] of [["customer", "CUSTOMER"], ["supplier", "SUPPLIER"]]) id[k] = (await cloud.ledgerAccount.create({ data: { code: k.toUpperCase(), name: k, kind: "PARTY", subType: sub } })).id;
  await createPurchaseInvoice(cloud, { id: id.admin, role: "ADMIN" }, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.cups, quantity: 10, unit: "carton", unitPrice: 8261 }] });

  const h = await registerDevice(cloud, { name: "Office server", role: "HUB", registeredById: id.admin });
  hub = { db: await migrated("hub.db"), id: h.device.id, t: hubToCloud(h.device.id) };
  for (const name of ["A", "B", "C"]) {
    const r = await registerDevice(cloud, { name: `PC ${name}`, role: "DEVICE", hubId: hub.id, registeredById: id.admin });
    pcs[name] = { db: await migrated(`pc-${name}.db`), local: { id: r.device.id, code: r.device.code }, t: undefined as unknown as Transport };
    pcs[name].t = deviceToHub(hub.db, hub.id, r.device.id);
  }
  expect((await syncOnce(hub.db, hub.t)).error).toBeUndefined(); // hub copies the cloud
  for (const name of ["A", "B", "C"]) expect((await syncOnce(pcs[name].db, pcs[name].t)).error).toBeUndefined(); // PCs copy the hub
});

afterAll(async () => {
  await cleanup?.();
});

describe("Mode A: internet down, office network up", () => {
  it("A, B and C share pending entries and stock through the office server", async () => {
    net.internet = false;
    const a = await submitCommand(pcs.A.db, pcs.A.local, sale(4));
    expect((await syncOnce(pcs.A.db, pcs.A.t)).error).toBeUndefined();
    expect((await pcs.A.db.outboxCommand.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("RELAYED");

    await syncOnce(pcs.B.db, pcs.B.t);
    expect(await overlayStock("B")).toBe("12000"); // 20,000 less A's 8,000 still at the office server
    const b = await submitCommand(pcs.B.db, pcs.B.local, sale(5));
    expect((JSON.parse(b.preview!) as Preview).hasNegativeStock).toBe(false);
    await syncOnce(pcs.B.db, pcs.B.t);

    await syncOnce(pcs.C.db, pcs.C.t);
    expect(await overlayStock("C")).toBe("2000");
    const c = await submitCommand(pcs.C.db, pcs.C.local, sale(2));
    expect((JSON.parse(c.preview!) as Preview).hasNegativeStock).toBe(true); // C is warned: the office has oversold
    await syncOnce(pcs.C.db, pcs.C.t);

    const queue = await hub.db.outboxCommand.findMany({ where: { seq: { gt: 0 } }, orderBy: { seq: "asc" } });
    expect(queue.map((q) => [q.id, q.originDeviceId])).toEqual([[a.id, pcs.A.local.id], [b.id, pcs.B.local.id], [c.id, pcs.C.local.id]]);
    expect(await cloud.accountingDocument.count({ where: { type: "SALE_INVOICE" } })).toBe(0); // nothing posted yet
    id.a = a.id; id.b = b.id; id.c = c.id;
  });

  it("when the internet returns, the hub forwards everything once, in office order, credited to each computer", async () => {
    net.internet = true;
    const r = await syncOnce(hub.db, hub.t);
    expect([r.accepted, r.needsReview, r.error]).toEqual([3, 0, undefined]);
    const docs = await cloud.accountingDocument.findMany({ where: { type: "SALE_INVOICE" }, orderBy: { number: "asc" } });
    expect(docs.map((d) => [d.docNo, d.commandId, d.originDeviceId])).toEqual([
      ["SI-0001", id.a, pcs.A.local.id], ["SI-0002", id.b, pcs.B.local.id], ["SI-0003", id.c, pcs.C.local.id],
    ]);
    for (const name of ["A", "B", "C"]) await syncOnce(pcs[name].db, pcs[name].t);
    const results = await Promise.all(["A", "B", "C"].map(async (n) => (await pcs[n].db.outboxCommand.findFirstOrThrow({ where: { status: { not: "OFFICE_PENDING" }, seq: { gt: 0 } } }))));
    expect(results.map((x) => [x.status, JSON.parse(x.result!).docNo])).toEqual([["SYNCED", "SI-0001"], ["SYNCED", "SI-0002"], ["SYNCED", "SI-0003"]]);
    const cloudTb = await trialBalance(cloud);
    for (const n of ["A", "B", "C"]) {
      expect((await trialBalance(pcs[n].db)).rows).toEqual(cloudTb.rows);
      expect(await pcs[n].db.outboxCommand.count({ where: { status: "OFFICE_PENDING" } })).toBe(0);
    }
    expect((await stockReport(pcs.A.db, { locationCode: "MAIN" })).rows[0].onHand).toBe("-2000");
  });

  it("an entry that reaches the cloud both directly and through the hub is posted once", async () => {
    net.internet = false;
    const e = await submitCommand(pcs.A.db, pcs.A.local, sale(1));
    await syncOnce(pcs.A.db, pcs.A.t); // held by the hub
    // A briefly had its own internet connection and sent the same entry straight to the cloud
    const direct = await pushCommands(cloud, { id: pcs.A.local.id, role: "DEVICE" }, [JSON.parse(e.payload)]);
    expect(direct[0].outcome.status).toBe("ACCEPTED");
    net.internet = true;
    const r = await syncOnce(hub.db, hub.t); // the hub forwards it too
    expect(r.accepted).toBe(1); // the cloud answers with the stored result
    expect(await cloud.accountingDocument.count({ where: { commandId: e.id } })).toBe(1);
  });

  it("a hub may only forward entries for computers registered to it", async () => {
    const stranger = await registerDevice(cloud, { name: "Home laptop", role: "DEVICE", registeredById: id.admin });
    const forged = await pushCommands(cloud, { id: hub.id, role: "HUB" }, [{ relayFor: stranger.device.id, command: { ...sale(1), id: crypto.randomUUID(), createdAt: new Date().toISOString() } }]);
    expect(forged[0].outcome).toMatchObject({ status: "REJECTED", code: 403 });
    const plainDevice = await pushCommands(cloud, { id: pcs.B.local.id, role: "DEVICE" }, [{ relayFor: pcs.A.local.id, command: { ...sale(1), id: crypto.randomUUID(), createdAt: new Date().toISOString() } }]);
    expect(plainDevice[0].outcome.status).toBe("REJECTED");
    const fromStranger = deviceToHub(hub.db, hub.id, stranger.device.id);
    await syncOnce(hub.db, hub.t); // hub learns about the new device
    await expect(fromStranger.push([])).rejects.toThrow(/not registered to this office server/);
  });
});

describe("Mode B: no internet and no office network", () => {
  it("each computer works alone; reconnecting flags an oversell for review instead of overwriting", async () => {
    await setSetting(cloud, "NEGATIVE_STOCK_POLICY", "BLOCK", id.admin);
    // Stock stands at -4,000 pieces after Mode A; restock 3 cartons so exactly one carton (2,000) is available
    await createPurchaseInvoice(cloud, { id: id.admin, role: "ADMIN" }, { date: "2026-10-22", partyAccountId: id.supplier, lines: [{ componentId: id.cups, quantity: 3, unit: "carton", unitPrice: 8261 }] });
    await syncOnce(hub.db, hub.t);
    for (const n of ["A", "B"]) await syncOnce(pcs[n].db, pcs[n].t);
    net.lan = false;
    net.internet = false;
    const a = await submitCommand(pcs.A.db, pcs.A.local, sale(1));
    const b = await submitCommand(pcs.B.db, pcs.B.local, sale(1));
    // Neither can see the other's entry: their local stock pictures differ
    expect(await overlayStock("A")).toBe(await overlayStock("B"));
    net.lan = true;
    net.internet = true;
    await syncOnce(pcs.A.db, pcs.A.t);
    await syncOnce(pcs.B.db, pcs.B.t);
    await syncOnce(hub.db, hub.t);
    await syncOnce(pcs.A.db, pcs.A.t);
    await syncOnce(pcs.B.db, pcs.B.t);
    const ra = await pcs.A.db.outboxCommand.findUniqueOrThrow({ where: { id: a.id } });
    const rb = await pcs.B.db.outboxCommand.findUniqueOrThrow({ where: { id: b.id } });
    expect(ra.status).toBe("SYNCED");
    expect([rb.status, rb.lastError]).toEqual(["NEEDS_REVIEW", expect.stringMatching(/Not enough stock/)]);
    expect(await cloud.accountingDocument.count({ where: { commandId: b.id } })).toBe(0);
    await setSetting(cloud, "NEGATIVE_STOCK_POLICY", "ALLOW_WITH_WARNING", id.admin);
  });
});

describe("office server failure (Report 23 §4.3)", () => {
  it("its computers move to a replacement office server; entries it never forwarded are sent once", async () => {
    await syncOnce(hub.db, hub.t);
    await syncOnce(pcs.A.db, pcs.A.t); // A has the current settings
    net.internet = false;
    const e = await submitCommand(pcs.A.db, pcs.A.local, sale(1));
    await syncOnce(pcs.A.db, pcs.A.t);
    expect((await pcs.A.db.outboxCommand.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("RELAYED"); // held by the hub, which now fails
    net.internet = true;

    const h2 = await registerDevice(cloud, { name: "Replacement office server", role: "HUB", registeredById: id.admin });
    await expect(moveDevices(cloud, hub.id, hub.id)).rejects.toThrow(/another active office server/);
    const moved = await moveDevices(cloud, hub.id, h2.device.id);
    expect(moved.moved).toBe(3);
    const hub2 = { db: await migrated("hub2.db"), id: h2.device.id, t: hubToCloud(h2.device.id) };
    expect((await syncOnce(hub2.db, hub2.t)).error).toBeUndefined();

    const toHub2 = { ...deviceToHub(hub2.db, hub2.id, pcs.A.local.id), upstreamId: "hub2" };
    expect((await syncOnce(pcs.A.db, toHub2)).error).toBeUndefined(); // A resends the held entry to the new server
    expect((await syncOnce(hub2.db, hub2.t)).accepted).toBe(1);
    await syncOnce(pcs.A.db, toHub2);
    expect((await pcs.A.db.outboxCommand.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("SYNCED");
    expect(await cloud.accountingDocument.count({ where: { commandId: e.id } })).toBe(1);
    // The failed server can no longer forward for them
    const late = await pushCommands(cloud, { id: hub.id, role: "HUB" }, [{ relayFor: pcs.B.local.id, command: { ...sale(1), id: crypto.randomUUID(), createdAt: new Date().toISOString() } }]);
    expect(late[0].outcome.status).toBe("REJECTED");
  });
});
