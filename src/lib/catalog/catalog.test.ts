// Phase 1 of Report 32 (owner approval 2026-11-13): packet = 100 sheets by default from one unit profile, packet size
// locked after the first stock movement, whole packets + loose sheets, reorder level in packets, short numbers from a
// counter (never MAX + 1), the one-time catch-up for existing rows, and the Item Group price.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "../accounting/test-db";
import { Actor, PostingError, unitConfigFor } from "../accounting/posting";
import { createScreenSale } from "../sales/books-sales";
import { createSupplier } from "../purchases/suppliers";
import { createProduct, updateProduct } from "./products";
import { ensureCatalog } from "./ensure";
import { groupPriceImpact, setGroupPrice } from "./groups";
import { nextPartyNo, parseShortNo } from "./numbers";
import { productRow } from "./rows";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const admin: Actor = { id: "u-admin", role: "ADMIN" };
const clerk: Actor = { id: "u-clerk", role: "INVENTORY_MANAGER" };
let cat: string;
let customer: string;

const stockOf = async (id: string) => Number((await db.component.findUniqueOrThrow({ where: { id } })).quantity);
const err = async (p: Promise<unknown>) => p.then(() => null, (e: PostingError) => ({ status: e.status, message: e.message }));
const paper = (over: Record<string, unknown> = {}) => ({
  name: "Uncoated 19x25", categoryId: cat, dimensionX: 19, dimensionY: 25, gsm: 300, purchaseRatePerKg: 109.26, saleRatePerKg: 115, ...over,
});

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  cat = (await db.componentCategory.create({ data: { name: "Uncoated" } })).id;
  customer = (await db.customer.create({ data: { name: "Power Press" } })).id;
});
afterAll(async () => cleanup());

describe("products: packet = 100 sheets from one unit profile", () => {
  it("a new product is paper in packets of 100 sheets; the older fields are copies; numbers 1, 2", async () => {
    const p = await createProduct(db, admin, paper());
    const q = await createProduct(db, admin, paper({ name: "Second" }));
    expect([p.itemNo, q.itemNo]).toEqual([1, 2]);
    const { cfg } = unitConfigFor(p);
    expect(cfg).toMatchObject({ kind: "PAPER", baseUnit: "sheet", saleUnit: "packet", purchaseUnit: "packet" });
    expect(cfg.conversions).toEqual([{ code: "packet", factor: "100", decimals: 0 }]);
    expect(p.unitProfile?.confirmed).toBe(true);
    expect({ unit: p.unit, rimInSheet: p.rimInSheet, itemsPerPackage: p.itemsPerPackage, packagingUnit: p.packagingUnit })
      .toEqual({ unit: "sheet", rimInSheet: 100, itemsPerPackage: 100, packagingUnit: "Packet" });
    // Supplier Invoice 754 row 1: 9.1935 kg a packet x Rs 109.26 = Rs 1,004.4871 a packet; sale 9.1935 x 115
    expect(p.unitCost).toBe(1004.4871);
    expect(p.unitPrice).toBe(1057.2581);
    expect([p.ratePerKg, p.saleRatePerKg]).toEqual([109.26, 115]);
  });

  it("opening stock is whole packets + loose sheets, valued per packet; reorder level in packets", async () => {
    const p = await createProduct(db, admin, paper({ name: "Opening", openingPackets: 2, openingLoose: 30, reorderLevel: 5 }));
    expect(await stockOf(p.id)).toBe(230);
    expect(p.minQuantity).toBe(500);
    // The list shows it as the old screen did: 2 packets + 30 sheets, reorder level 5 packets
    expect(productRow(p)).toMatchObject({ stockPacks: 2, stockLoose: 30, packSize: 100, reorderLevel: 5, locked: true });
    const os = await db.accountingDocument.findFirstOrThrow({ where: { type: "OPENING_STOCK" }, include: { lines: true } });
    expect(os.lines[0]).toMatchObject({ quantity: "2", unit: "packet", loose: "30" });
    expect(await err(createProduct(db, admin, paper({ name: "Too loose", openingPackets: 1, openingLoose: 100 })))).toMatchObject({ status: 400 });
    expect(await err(createProduct(db, admin, paper({ name: "No rate", purchaseRatePerKg: null, openingPackets: 1 })))).toMatchObject({ status: 400 });
    expect(await err(createProduct(db, admin, paper({ name: "Half", openingPackets: 1.5 })))).not.toBeNull();
  });

  it("selling 1 packet takes exactly 100 sheets; 2 packets + 30 sheets take 230", async () => {
    const p = await createProduct(db, admin, paper({ name: "Sell me", openingPackets: 10 }));
    await createScreenSale(db, admin, { date: "2026-11-13", customerId: customer, paidNow: { amount: "0", method: "CASH" }, items: [{ componentId: p.id, quantity: 1, unit: "packet", unitPrice: "1000" }] });
    expect(await stockOf(p.id)).toBe(900);
    await createScreenSale(db, admin, { date: "2026-11-13", customerId: customer, paidNow: { amount: "0", method: "CASH" }, items: [{ componentId: p.id, quantity: 2, unit: "packet", loose: 30, unitPrice: "1000" }] });
    expect(await stockOf(p.id)).toBe(670);
  });

  it("other packet sizes (250 sheets) are kept per product", async () => {
    const p = await createProduct(db, admin, paper({ name: "Big packet", packSize: 250, openingPackets: 4 }));
    expect(await stockOf(p.id)).toBe(1000);
    await createScreenSale(db, admin, { date: "2026-11-13", customerId: customer, paidNow: { amount: "0", method: "CASH" }, items: [{ componentId: p.id, quantity: 1, unit: "packet", unitPrice: "1000" }] });
    expect(await stockOf(p.id)).toBe(750);
    expect(p.rimInSheet).toBe(250);
  });

  it("non-paper products keep their own units: carton of pieces, kg, service", async () => {
    const box = await createProduct(db, admin, { name: "Pizza box", categoryId: cat, kind: "PIECE", packSize: 50, packCode: "Bundle", purchasePrice: 500, salePrice: 600, openingPackets: 2, openingLoose: 7 });
    expect(unitConfigFor(box).cfg).toMatchObject({ kind: "PIECE", baseUnit: "piece", saleUnit: "bundle" });
    expect(await stockOf(box.id)).toBe(107);
    const ink = await createProduct(db, admin, { name: "Ink", categoryId: cat, kind: "WEIGHT", purchasePrice: 1730 });
    expect(unitConfigFor(ink).cfg).toMatchObject({ kind: "WEIGHT", baseUnit: "kg", baseDecimals: 3 });
    const labour = await createProduct(db, admin, { name: "Labour", categoryId: cat, kind: "SERVICE" });
    expect(unitConfigFor(labour).cfg.kind).toBe("SERVICE");
  });
});

describe("packet size is locked after the first stock movement", () => {
  it("free to change before any movement", async () => {
    const p = await createProduct(db, admin, paper({ name: "Unmoved" }));
    const u = await updateProduct(db, clerk, p.id, paper({ name: "Unmoved", packSize: 200 }));
    expect(unitConfigFor(u).cfg.conversions?.[0]?.factor).toBe("200");
    expect(u.rimInSheet).toBe(200);
  });

  it("refused after a movement; an administrator corrects it with a reason, audited; old bill lines unchanged", async () => {
    const p = await createProduct(db, admin, paper({ name: "Moved", openingPackets: 3 }));
    const lineBefore = await db.accountingDocumentLine.findFirstOrThrow({ where: { componentId: p.id } });
    expect(await err(updateProduct(db, clerk, p.id, paper({ name: "Moved", packSize: 200, correctionReason: "the mill sends 200 now" })))).toMatchObject({ status: 409 });
    expect(await err(updateProduct(db, admin, p.id, paper({ name: "Moved", packSize: 200 })))).toMatchObject({ status: 409 });
    expect(await err(updateProduct(db, admin, p.id, paper({ name: "Moved", kind: "PIECE", correctionReason: "x" })))).toMatchObject({ status: 409 });
    const fixed = await updateProduct(db, admin, p.id, paper({ name: "Moved", packSize: 200, correctionReason: "Packet size was set wrong at entry" }));
    expect(fixed.rimInSheet).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: p.id, action: "UNIT_CORRECTION" } });
    expect(audit.reason).toBe("Packet size was set wrong at entry");
    const lineAfter = await db.accountingDocumentLine.findFirstOrThrow({ where: { id: lineBefore.id } });
    expect(lineAfter).toEqual(lineBefore);
    expect(await stockOf(p.id)).toBe(300);
  });

  it("rates and the name change freely; the sale rate never moves the purchase rate; opening stock only once", async () => {
    const p = await createProduct(db, admin, paper({ name: "Rates", openingPackets: 1 }));
    const u = await updateProduct(db, clerk, p.id, paper({ name: "Rates renamed", saleRatePerKg: 220 }));
    expect([u.name, u.ratePerKg, u.saleRatePerKg]).toEqual(["Rates renamed", 109.26, 220]);
    expect(await err(updateProduct(db, admin, p.id, paper({ name: "Rates", openingPackets: 5 })))).toMatchObject({ status: 400 });
  });
});

describe("short numbers", () => {
  it("parallel saves never get the same number", async () => {
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => createProduct(db, admin, paper({ name: `Parallel ${i}` }))));
    const nos = made.map((m) => m.itemNo!);
    expect(new Set(nos).size).toBe(8);
    const all = (await db.component.findMany({ select: { itemNo: true } })).map((c) => c.itemNo);
    expect(new Set(all).size).toBe(all.length);
  });

  it("customers and suppliers share one sequence", async () => {
    const before = await db.$transaction((tx) => nextPartyNo(tx));
    const s = await createSupplier(db, "u-admin", { name: "Dalazak Road" });
    const n = await Promise.all([1, 2, 3].map(() => db.$transaction((tx) => nextPartyNo(tx))));
    expect(s.partyNo).toBe(before + 1);
    expect(n.sort((a, b) => a - b)).toEqual([before + 2, before + 3, before + 4]);
  });

  it("only digits are a number", () => {
    expect([parseShortNo("176"), parseShortNo(" 007 "), parseShortNo("17a"), parseShortNo("0"), parseShortNo("")]).toEqual([176, 7, null, null, null]);
  });
});

describe("one-time catch-up on the main server", () => {
  it("gives profiles equal to today's units and numbers in creation order, once", async () => {
    const t0 = Date.now();
    const old1 = await db.component.create({ data: { sku: "OLD-1", name: "Old board", categoryId: cat, unit: "piece", itemsPerPackage: 1, packagingUnit: "Carton", createdAt: new Date(t0 - 3000) } });
    const old2 = await db.component.create({ data: { sku: "OLD-2", name: "Old sheet", categoryId: cat, unit: "sheet", rimInSheet: 100, createdAt: new Date(t0 - 2000) } });
    const c1 = await db.customer.create({ data: { name: "Old customer", createdAt: new Date(t0 - 5000) } });
    const s1 = await db.supplier.create({ data: { name: "Old supplier", createdAt: new Date(t0 - 4000) } });
    const before1 = unitConfigFor({ ...old1, unitProfile: null }).cfg;
    const before2 = unitConfigFor({ ...old2, unitProfile: null }).cfg;

    const r = await ensureCatalog(db);
    expect(r.profiles).toBeGreaterThanOrEqual(2);
    const [a, b] = await Promise.all([old1, old2].map((o) => db.component.findUniqueOrThrow({ where: { id: o.id }, include: { unitProfile: { include: { conversions: true } } } })));
    expect(unitConfigFor(a).cfg).toMatchObject({ kind: before1.kind, baseUnit: before1.baseUnit });
    expect(unitConfigFor(b).cfg.conversions?.[0]).toMatchObject({ code: "packet", factor: String(before2.conversions?.[0]?.factor) });
    expect(a.unitProfile?.confirmed).toBe(false);
    expect(a.itemNo! < b.itemNo!).toBe(true);
    const [cc, ss] = await Promise.all([db.customer.findUniqueOrThrow({ where: { id: c1.id } }), db.supplier.findUniqueOrThrow({ where: { id: s1.id } })]);
    expect(cc.partyNo! < ss.partyNo!).toBe(true);

    expect(await ensureCatalog(db)).toEqual({ profiles: 0, resynced: 0, itemNos: 0, partyNos: 0 });
    const next = await createProduct(db, admin, paper({ name: "After catch-up" }));
    expect(next.itemNo).toBe(b.itemNo! + 1);
  });
});

describe("Item Group price", () => {
  it("shows how many products change, needs that number confirmed, and leaves bills alone", async () => {
    const g = (await db.componentCategory.create({ data: { name: "Cheetah" } })).id;
    const p = await createProduct(db, admin, { ...paper({ name: "Cheetah 25x36", categoryId: g, dimensionX: 25, dimensionY: 36, gsm: 300, purchaseRatePerKg: 177 }), openingPackets: 1 });
    await createProduct(db, admin, paper({ name: "Cheetah 22x32", categoryId: g, dimensionX: 22, dimensionY: 32, gsm: 300 }));
    const line = await db.accountingDocumentLine.findFirstOrThrow({ where: { componentId: p.id } });

    expect((await groupPriceImpact(db, g)).products).toBe(2);
    expect(await err(setGroupPrice(db, admin, g, { ratePerKg: 180, updateProducts: true, confirmCount: 1 }))).toMatchObject({ status: 409 });
    const r = await setGroupPrice(db, admin, g, { ratePerKg: 180, updateProducts: true, confirmCount: 2 });
    expect(r.productsUpdated).toBe(2);
    const after = await db.component.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.ratePerKg).toBe(180);
    // 25 x 36 x 300 / 15500 = 17.41935… kg (not rounded, as the old program) x Rs 180 = Rs 3,135.4839 a packet
    expect(after.unitCost).toBe(3135.4839);
    expect(await db.accountingDocumentLine.findFirstOrThrow({ where: { id: line.id } })).toEqual(line);
    expect(await db.auditLog.count({ where: { entity: "ComponentCategory", entityId: g } })).toBe(1);

    const only = await setGroupPrice(db, admin, g, { ratePerKg: 190 });
    expect([only.group.ratePerKg, only.productsUpdated]).toEqual([190, 0]);
    expect((await db.component.findUniqueOrThrow({ where: { id: p.id } })).ratePerKg).toBe(180);
  });
});
