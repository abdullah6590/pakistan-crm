// The paper sale screen (0.1.8, owner's video of the old Customer Invoice): paper sold in packets of 100 sheets with
// the size, GSM and rate per kg kept on the bill line, and Labour as a line that holds no stock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "../accounting/test-db";
import { Actor, cancelDocument, createPurchaseInvoice } from "../accounting/posting";
import { amendScreenSale, createScreenSale } from "./books-sales";
import { stepBill } from "./step";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const admin: Actor = { id: "u-admin", role: "ADMIN" };
const id: Record<string, string> = {};

const stockOf = async (componentId: string) => Number((await db.component.findUniqueOrThrow({ where: { id: componentId } })).quantity);
const movementsOf = (documentId: string) => db.stockMovement.findMany({ where: { documentId } });

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  // Item "a" of the old invoice: 20 x 28 inches, 200 gm, sold in packets of 100 sheets
  const a = await db.component.create({ data: { sku: "230", name: "a", categoryId: cat.id, unit: "sheet", dimensionX: 20, dimensionY: 28, gsm: 200 } });
  await db.itemUnitProfile.create({ data: { componentId: a.id, kind: "PAPER", baseUnit: "sheet", purchaseUnit: "packet", saleUnit: "packet", confirmed: true, conversions: { create: [{ code: "packet", factor: "100" }] } } as never });
  id.a = a.id;
  // Labour (old item 65): a service, billed on the invoice like an item
  const labour = await db.component.create({ data: { sku: "65", name: "Labour", categoryId: cat.id, unit: "service" } });
  await db.itemUnitProfile.create({ data: { componentId: labour.id, kind: "SERVICE", baseUnit: "service", confirmed: true } as never });
  id.labour = labour.id;
  const supplier = (await db.ledgerAccount.create({ data: { code: "SUP", name: "Mill", kind: "PARTY", subType: "SUPPLIER" } })).id;
  await createPurchaseInvoice(db, admin, { date: "2026-11-01", partyAccountId: supplier, lines: [{ componentId: id.a, quantity: 200, unit: "packet", unitPrice: "1000" }] });
  id.customer = (await db.customer.create({ data: { name: "Power Press", phone: "0300" } })).id;
});
afterAll(async () => cleanup());

describe("paper sale screen", () => {
  it("the old invoice 5726: 169 packets of a (20x28x200, Rs 155/kg = Rs 1,120 a packet) plus Labour 850 x Rs 1 = Rs 190,130", async () => {
    const before = await stockOf(id.a);
    const r = await createScreenSale(db, admin, {
      date: "2026-11-11", customerId: id.customer, paidNow: { amount: "0", method: "CASH" },
      items: [
        { componentId: id.a, quantity: 169, unit: "packet", unitPrice: "1120", paper: { x: 20, y: 28, gsm: 200, ratePerKg: 155 } },
        { componentId: id.labour, quantity: 850, unitPrice: "1" },
      ],
    });
    expect(r.document.total).toBe("190130");
    const lines = await db.accountingDocumentLine.findMany({ where: { documentId: r.document.id }, orderBy: { lineNo: "asc" } });
    expect([lines[0].paperX, lines[0].paperY, lines[0].paperGsm, lines[0].ratePerKg, lines[0].baseQuantity, lines[0].amount]).toEqual(["20", "28", "200", "155", "16900", "189280"]);
    expect(Number(lines[0].kgPerUnit)).toBeCloseTo(7.2258, 4); // old "Kg"; 169 packets = 1,221.16 kg (old "Net Wait")
    expect([lines[1].amount, lines[1].costAmount, lines[1].kgPerUnit]).toEqual(["850", "0", null]);
    // Only the paper left stock; Labour moved nothing and the bill is not marked for negative stock
    expect(before - (await stockOf(id.a))).toBe(16900);
    const moves = await movementsOf(r.document.id);
    expect(moves.map((m) => m.componentId)).toEqual([id.a]);
    expect(r.document.hasNegativeStock).toBe(false);
    id.bill = r.document.id;
  });

  it("packets plus loose sheets: 2 packets + 30 sheets at Rs 1,120 a packet = Rs 2,576 (sheets at Rs 11.20)", async () => {
    const r = await createScreenSale(db, admin, {
      date: "2026-11-11", walkInName: "Counter",
      items: [{ componentId: id.a, quantity: 2, unit: "packet", loose: 30, unitPrice: "1120", paper: { x: 20, y: 28, gsm: 200, ratePerKg: 155 } }],
    });
    const [line] = await db.accountingDocumentLine.findMany({ where: { documentId: r.document.id } });
    expect([r.document.type, r.document.total, line.baseQuantity]).toEqual(["CASH_SALE", "2576", "230"]);
  });

  it("cancelling the bill puts the paper back; Labour has nothing to put back", async () => {
    const before = await stockOf(id.a);
    await cancelDocument(db, admin, id.bill, "Typed against the wrong customer");
    expect((await stockOf(id.a)) - before).toBe(16900);
    expect(await stockOf(id.labour)).toBe(0);
  });

  it("<< < > >> step through bills of one kind by number; an edited bill counts once; cash sales step on their own", async () => {
    const mk = (packets: number) => createScreenSale(db, admin, { date: "2026-11-12", customerId: id.customer, paidNow: { amount: "0", method: "CASH" }, items: [{ componentId: id.a, quantity: packets, unit: "packet", unitPrice: "1120" }] });
    const b1 = (await mk(1)).document;
    const b2 = (await mk(2)).document;
    // b2 is corrected: its new revision replaces it (same number), the old version no longer counts
    const b2r = (await amendScreenSale(db, admin, b2.id, { date: "2026-11-12", customerId: id.customer, items: [{ componentId: id.a, quantity: 3, unit: "packet", unitPrice: "1120" }] }, "Three packets, not two")).document;
    expect((await stepBill(db, "SALE_INVOICE", "prev", b2r.id))?.id).toBe(b1.id);
    expect((await stepBill(db, "SALE_INVOICE", "next", b1.id))?.id).toBe(b2r.id);
    expect(await stepBill(db, "SALE_INVOICE", "next", b2r.id)).toBeNull(); // the last bill
    expect((await stepBill(db, "SALE_INVOICE", "last"))?.id).toBe(b2r.id);
    expect((await stepBill(db, "SALE_INVOICE", "prev"))?.id).toBe(b2r.id); // from a new bill: the last one saved
    const first = await stepBill(db, "SALE_INVOICE", "first");
    expect(first?.docNo).toMatch(/^SI-/);
    expect(await stepBill(db, "SALE_INVOICE", "prev", first!.id)).toBeNull();
    // Cash sales have their own series and are not mixed in
    const cash = await stepBill(db, "CASH_SALE", "last");
    expect(cash?.docNo).toMatch(/^CS-/);
    expect(await stepBill(db, "SALE_INVOICE", "next", cash!.id)).toBeNull();
  });
});
