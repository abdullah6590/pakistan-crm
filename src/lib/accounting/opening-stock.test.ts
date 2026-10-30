// Owner instruction 2026-10-26: products with their own units (packets, cartons, loose, kg); opening stock entered once per
// item at a confirmed cost (never zero), in any of the item's units; sales in pack units with loose stock units.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";
import { Actor, PostingError, createOpeningStock, createSaleInvoice } from "./posting";
import { openingStockCandidates, postOpeningStock } from "./opening-stock";
import { createScreenSale } from "@/lib/sales/books-sales";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let admin: Actor;
const id: Record<string, string> = {};

const count = async (componentId: string) => (await db.component.findUniqueOrThrow({ where: { id: componentId } })).quantity;
const onHand = async (componentId: string) => (await db.itemStockBalance.findFirstOrThrow({ where: { componentId } })).onHand;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  admin = { id: (await db.user.create({ data: { name: "admin", email: "admin@test.local", password: "x", role: "ADMIN" } })).id, role: "ADMIN" };
  const cat = await db.componentCategory.create({ data: { name: "Packing" } });
  const item = async (sku: string, name: string, quantity: number, profile?: { kind: string; baseUnit: string; baseDecimals?: number; conversions: { code: string; factor: string }[]; saleUnit?: string }) => {
    const c = await db.component.create({ data: { sku, name, categoryId: cat.id, quantity } });
    if (profile) {
      await db.itemUnitProfile.create({
        data: {
          componentId: c.id, kind: profile.kind, baseUnit: profile.baseUnit, baseDecimals: profile.baseDecimals ?? 0, saleUnit: profile.saleUnit, confirmed: true,
          conversions: { create: profile.conversions.map((u) => ({ code: u.code, factor: u.factor })) },
        },
      });
    }
    return c.id;
  };
  // Owner-named products with their own units; nothing about them is built in
  id.cups = await item("CUP-8", "8oz cup", 2500, { kind: "PIECE", baseUnit: "piece", conversions: [{ code: "carton", factor: "1000" }, { code: "sleeve", factor: "50" }], saleUnit: "sleeve" });
  id.sheet = await item("SHT-1", "Art card 300gsm", 0, { kind: "PAPER", baseUnit: "sheet", conversions: [{ code: "packet", factor: "100" }], saleUnit: "packet" });
  id.glue = await item("GLU", "Glue", 0, { kind: "WEIGHT", baseUnit: "kg", baseDecimals: 3, conversions: [] });
  id.unknown = await item("BB", "Board with unknown cost", 75);
  id.customer = (await db.customer.create({ data: { name: "Test Customer" } })).id;
});
afterAll(async () => cleanup());

describe("opening stock", () => {
  it("is never valued at zero: an unknown cost stays out", async () => {
    const e = await createOpeningStock(db, admin, { date: "2026-10-01", lines: [{ componentId: id.unknown, quantity: 75, unitCost: 0 }] }).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(PostingError);
    expect((e as Error).message).toMatch(/never valued at zero/);
    expect(await count(id.unknown)).toBe(75);
    expect(await db.accountingDocument.count()).toBe(0);
    expect((await openingStockCandidates(db)).map((c) => c.name)).toContain("Board with unknown cost");
  });

  it("is entered in the item's own units: 2 cartons + 500 loose pieces at Rs 1,200 a carton", async () => {
    const r = await postOpeningStock(db, admin, { date: "2026-10-01", requestId: "os-request-0001", lines: [{ componentId: id.cups, quantity: 2, unit: "carton", loose: 500, unitCost: 1200 }] });
    expect(r.document.total).toBe("3000"); // 2,500 pieces at Rs 1.20
    expect(await onHand(id.cups)).toBe("2500");
    expect(await count(id.cups)).toBe(2500); // the earlier count of 2,500 is replaced, not added to
    const hist = await db.inventoryHistory.findMany({ where: { componentId: id.cups }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => h.reference)).toEqual([expect.stringMatching(/Count of 2500 before opening stock/), expect.stringMatching(/^Books OS-0001/)]);
    const line = await db.accountingDocumentLine.findFirstOrThrow({ where: { documentId: r.document.id } });
    expect([line.quantity, line.unit, line.loose, line.baseQuantity, line.unitPrice]).toEqual(["2", "carton", "500", "2500", "1200"]);
  });

  it("is entered once: a repeated click returns the first entry, a second entry is refused", async () => {
    const again = await postOpeningStock(db, admin, { requestId: "os-request-0001", lines: [{ componentId: id.cups, quantity: 2, unit: "carton", loose: 500, unitCost: 1200 }] });
    expect([again.repeated, again.document.docNo]).toEqual([true, "OS-0001"]);
    const second = await postOpeningStock(db, admin, { lines: [{ componentId: id.cups, quantity: 1, unit: "carton", unitCost: 1200 }] }).then(() => null, (x) => (x as Error).message);
    expect(second).toMatch(/already in Books/);
    expect(await onHand(id.cups)).toBe("2500");
    expect((await openingStockCandidates(db)).map((c) => c.name)).not.toContain("8oz cup");
  });

  it("paper by the packet and glue by the kg", async () => {
    await postOpeningStock(db, admin, { lines: [
      { componentId: id.sheet, quantity: 10, unit: "packet", unitCost: 2500 },
      { componentId: id.glue, quantity: "12.5", unitCost: 400 },
    ] });
    expect([await onHand(id.sheet), await count(id.sheet)]).toEqual(["1000", 1000]);
    expect([await onHand(id.glue), await count(id.glue)]).toEqual(["12.5", 13]);
  });
});

describe("selling in the item's units", () => {
  it("a bill in sleeves with loose pieces: amount, stock and cost in pieces", async () => {
    const r = await createScreenSale(db, admin, { date: "2026-10-02", customerId: id.customer, items: [{ componentId: id.cups, quantity: 3, unit: "sleeve", loose: 10, unitPrice: 100 }] });
    expect(r.document.total).toBe("320"); // 3 sleeves x 100 + 10 pieces x 2
    expect(await onHand(id.cups)).toBe("2340");
    expect(await count(id.cups)).toBe(2340);
    const line = await db.accountingDocumentLine.findFirstOrThrow({ where: { documentId: r.document.id } });
    expect([line.unit, line.loose, line.baseQuantity, line.costAmount]).toEqual(["sleeve", "10", "160", "192"]); // 160 x 1.20
  });

  it("a unit the item does not have is refused", async () => {
    const e = await createScreenSale(db, admin, { customerId: id.customer, items: [{ componentId: id.cups, quantity: 1, unit: "packet", unitPrice: 5 }] }).then(() => null, (x) => (x as Error).message);
    expect(e).toMatch(/not defined for this item/);
  });

  it("small kg sales never drift the Inventory count away from Books", async () => {
    const party = (await db.ledgerAccount.findFirstOrThrow({ where: { customerId: id.customer } })).id;
    for (let i = 0; i < 3; i++) await createSaleInvoice(db, admin, { date: "2026-10-03", partyAccountId: party, lines: [{ componentId: id.glue, quantity: "0.4", unitPrice: 600 }] });
    expect(await onHand(id.glue)).toBe("11.3");
    expect(await count(id.glue)).toBe(11); // the rounded Books balance, not 13
  });
});
