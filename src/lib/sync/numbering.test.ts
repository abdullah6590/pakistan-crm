// Phase 5: official numbering across computers and reconciliation tools (Report 21 §12).
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createPurchaseInvoice, createSaleInvoice } from "@/lib/accounting/posting";
import { createPrismaClient } from "@/lib/prisma";
import { applyMigrations } from "@/lib/tenancy/migrate";
import { submitCommand } from "./outbox";
import { registerDevice, pushCommands, pullChanges, snapshot, reserveBlock, releaseBlocks } from "./server";
import { relayCommands, officePending, ensureNumberBlocks, hubNumberSeries } from "./hub";
import { syncOnce, Transport, NetworkError } from "./worker";
import { reconcileCentral, reconcileLocal, numberingReport, documentTotals } from "./reconcile";

let cloud: PrismaClient;
let cleanup: () => Promise<void>;
let dir: string;
const id: Record<string, string> = {};
const net = { internet: true };
let hub: { db: PrismaClient; id: string; t: Transport };
let pc: { db: PrismaClient; local: { id: string; code: string }; t: Transport };

const sale = (cartons: number, price = 9000) => ({
  type: "CREATE_DOCUMENT", actorUserId: id.clerk, docType: "SALE_INVOICE",
  input: { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: cartons, unit: "carton", unitPrice: price }] },
});

beforeAll(async () => {
  const t = await createTestDb();
  ({ cleanup, dir } = t);
  cloud = t.db;
  id.clerk = (await cloud.user.create({ data: { name: "Clerk", email: "c@t", password: "x", role: "EMPLOYEE" } })).id;
  id.admin = (await cloud.user.create({ data: { name: "Admin", email: "a@t", password: "x", role: "ADMIN" } })).id;
  const cat = await cloud.componentCategory.create({ data: { name: "Cups" } });
  const cups = await cloud.component.create({ data: { sku: "C1", name: "Cup", categoryId: cat.id } });
  await cloud.itemUnitProfile.create({ data: { componentId: cups.id, kind: "PIECE", baseUnit: "piece", confirmed: true, conversions: { create: [{ code: "carton", factor: "2000" }] } } });
  id.cups = cups.id;
  for (const [k, sub] of [["customer", "CUSTOMER"], ["supplier", "SUPPLIER"]]) id[k] = (await cloud.ledgerAccount.create({ data: { code: k.toUpperCase(), name: k, kind: "PARTY", subType: sub } })).id;
  await createPurchaseInvoice(cloud, { id: id.admin, role: "ADMIN" }, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.cups, quantity: 50, unit: "carton", unitPrice: 8261 }] });

  const migrated = async (name: string) => {
    const file = `file:${path.join(dir, name).replace(/\\/g, "/")}`;
    await applyMigrations(file);
    return createPrismaClient(file, undefined);
  };
  const h = await registerDevice(cloud, { name: "Office server", role: "HUB", registeredById: id.admin });
  const guard = () => { if (!net.internet) throw new NetworkError("internet down"); };
  hub = {
    db: await migrated("hub.db"), id: h.device.id,
    t: {
      upstreamId: "cloud",
      push: async (items) => { guard(); return pushCommands(cloud, { id: h.device.id, role: "HUB" }, items); },
      pull: async (since) => { guard(); return pullChanges(cloud, since, 200); },
      snapshot: async () => { guard(); return snapshot(cloud); },
      reserve: async (series, size) => { guard(); return reserveBlock(cloud, h.device.id, series, size); },
    },
  };
  const d = await registerDevice(cloud, { name: "PC", role: "DEVICE", hubId: hub.id, registeredById: id.admin });
  pc = {
    db: await migrated("pc.db"), local: { id: d.device.id, code: d.device.code },
    t: {
      upstreamId: "hub",
      push: async (items) => relayCommands(hub.db, d.device.id, items, hub.id),
      pull: async (since) => pullChanges(hub.db, since, 200),
      snapshot: async () => snapshot(hub.db),
      office: async () => officePending(hub.db),
    },
  };
});

afterAll(async () => {
  await cleanup?.();
});

describe("official numbering with reserved blocks", () => {
  it("the cloud reserves a block for the hub and its own numbering skips the block", async () => {
    await createSaleInvoice(cloud, { id: id.clerk, role: "EMPLOYEE" }, { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 1, unit: "carton", unitPrice: 9000 }] }); // SI-0001
    const requested = await ensureNumberBlocks(hub.db, hub.id, ["SI"], 20, hub.t.reserve!);
    expect(requested).toEqual(["SI"]);
    const block = await cloud.numberBlock.findFirstOrThrow({ where: { deviceId: hub.id } });
    expect([block.series, block.fromNumber, block.toNumber]).toEqual(["SI", 2, 21]);
    const online = await createSaleInvoice(cloud, { id: id.clerk, role: "EMPLOYEE" }, { date: "2026-10-22", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 1, unit: "carton", unitPrice: 9000 }] });
    expect(online.docNo).toBe("SI-0022");
    await syncOnce(hub.db, hub.t);
    await syncOnce(pc.db, pc.t);
    expect(await ensureNumberBlocks(hub.db, hub.id, ["SI"], 20, hub.t.reserve!)).toEqual([]); // still enough left
  });

  it("during an outage the office server gives official numbers from its block; the cloud posts them unchanged", async () => {
    net.internet = false;
    const a = await submitCommand(pc.db, pc.local, sale(1));
    const b = await submitCommand(pc.db, pc.local, sale(2));
    await syncOnce(pc.db, pc.t);
    const rows = await pc.db.outboxCommand.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => [r.status, r.officialNumber])).toEqual([["RELAYED", "SI-0002"], ["RELAYED", "SI-0003"]]);
    net.internet = true;
    expect((await syncOnce(hub.db, hub.t)).accepted).toBe(2);
    const posted = await cloud.accountingDocument.findMany({ where: { commandId: { in: [a.id, b.id] } }, orderBy: { number: "asc" } });
    expect(posted.map((d) => d.docNo)).toEqual(["SI-0002", "SI-0003"]);
    await syncOnce(pc.db, pc.t);
    expect((await pc.db.outboxCommand.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SYNCED");
  });

  it("the cloud refuses a number outside the hub's blocks, from another hub, or already used", async () => {
    const other = await registerDevice(cloud, { name: "Other office", role: "HUB", registeredById: id.admin });
    const mk = () => ({ ...sale(1), id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    const outside = await pushCommands(cloud, { id: hub.id, role: "HUB" }, [{ relayFor: pc.local.id, command: mk(), assignedNumber: 500 }]);
    const used = await pushCommands(cloud, { id: hub.id, role: "HUB" }, [{ relayFor: pc.local.id, command: mk(), assignedNumber: 2 }]);
    const notTheirs = await pushCommands(cloud, { id: other.device.id, role: "HUB" }, [{ relayFor: pc.local.id, command: mk(), assignedNumber: 5 }]);
    expect([outside[0].outcome.status, used[0].outcome.status, notTheirs[0].outcome.status]).toEqual(["CONFLICT", "CONFLICT", "REJECTED"]);
  });

  it("the numbering report explains every gap; releasing a block keeps its unused numbers as documented gaps", async () => {
    const before = (await numberingReport(cloud)).find((n) => n.series === "SI")!;
    expect(before.gaps.length).toBeGreaterThan(0);
    expect(before.gaps.every((g) => g.reason.startsWith("reserved for office server"))).toBe(true);
    await releaseBlocks(cloud, hub.id);
    const after = (await numberingReport(cloud)).find((n) => n.series === "SI")!;
    expect(after.gaps.every((g) => /block released/.test(g.reason))).toBe(true);
    expect(after.gaps.some((g) => g.reason === "unexplained")).toBe(false);
  });

  it("D-3: office-server blocks are on by default for every series, can be turned off, and released numbers are never handed out again", async () => {
    const all = hubNumberSeries(undefined);
    for (const s of ["SI", "CS", "PI", "SIS", "SADJ", "CRV", "BPV", "JV"]) expect(all).toContain(s);
    expect(hubNumberSeries("none")).toEqual([]);
    expect(hubNumberSeries(" si , cs ")).toEqual(["SI", "CS"]);
    // After the earlier block was released, a new block starts above everything ever reserved or used
    const released = await cloud.numberBlock.findMany({ where: { series: "SI", status: "RELEASED" } });
    const fresh = await reserveBlock(cloud, hub.id, "SI", 10);
    expect(fresh.fromNumber).toBeGreaterThan(Math.max(...released.map((b) => b.toNumber)));
    const cv = await reserveBlock(cloud, hub.id, "CRV", 10); // a different series has its own range
    expect(cv.series).toBe("CRV");
    // A released number cannot be used by the hub any more
    const mk = () => ({ ...sale(1), id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    const reuse = await pushCommands(cloud, { id: hub.id, role: "HUB" }, [{ relayFor: pc.local.id, command: mk(), assignedNumber: released[0].toNumber }]);
    expect(reuse[0].outcome.status).toBe("CONFLICT");
  });
});

describe("reconciliation", () => {
  it("healthy books produce no errors; local copy totals match the server", async () => {
    const central = await reconcileCentral(cloud);
    expect(central.findings.filter((f) => f.severity === "ERROR")).toEqual([]);
    await syncOnce(hub.db, hub.t);
    await syncOnce(pc.db, pc.t);
    const atSeq = Number(((await cloud.$queryRawUnsafe("SELECT MAX(seq) AS m FROM change_log")) as { m: bigint }[])[0].m);
    // The computer syncs through the hub, so compare it with the hub's copy (which matches the cloud)
    expect(await documentTotals(hub.db)).toEqual(central.totals);
    const hubSeq = Number(((await hub.db.$queryRawUnsafe("SELECT MAX(seq) AS m FROM change_log")) as { m: bigint }[])[0].m);
    const local = await reconcileLocal(pc.db, { atSeq: hubSeq, totals: await documentTotals(hub.db) });
    expect(local.findings.filter((f) => f.severity === "ERROR")).toEqual([]);
    const behind = await reconcileLocal(pc.db, { atSeq: hubSeq + 5, totals: central.totals });
    expect(behind.findings.map((f) => f.check)).toContain("Local vs central totals");
    void atSeq;
  });

  it("detects a stray journal line, a tampered stock balance and a duplicate invoice", async () => {
    // Work on a copy so the main test books stay clean
    const copyFile = path.join(dir, "tampered.db").replace(/\\/g, "/");
    await cloud.$executeRawUnsafe(`VACUUM INTO '${copyFile}'`);
    const copy = createPrismaClient(`file:${copyFile}`, undefined);
    const entry = await copy.journalEntry.findFirstOrThrow({ where: { kind: "POSTING" } });
    const acct = await copy.ledgerAccount.findUniqueOrThrow({ where: { code: "SALES_REVENUE" } });
    await copy.journalLine.create({ data: { entryId: entry.id, accountId: acct.id, debitPaisa: BigInt(100), creditPaisa: BigInt(0) } });
    await copy.itemStockBalance.updateMany({ where: { componentId: id.cups }, data: { onHand: "123" } });
    await createSaleInvoice(copy, { id: id.clerk, role: "EMPLOYEE" }, { date: "2026-10-23", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 1, unit: "carton", unitPrice: 7777 }] });
    await createSaleInvoice(copy, { id: id.clerk, role: "EMPLOYEE" }, { date: "2026-10-23", partyAccountId: id.customer, lines: [{ componentId: id.cups, quantity: 1, unit: "carton", unitPrice: 7777 }] });
    const checks = new Set((await reconcileCentral(copy)).findings.map((f) => `${f.severity}:${f.check}`));
    expect(checks).toContain("ERROR:Unbalanced entry");
    expect(checks).toContain("ERROR:Stock discrepancy");
    expect(checks).toContain("WARNING:Possible duplicate");
    await copy.$disconnect();
  });
});
