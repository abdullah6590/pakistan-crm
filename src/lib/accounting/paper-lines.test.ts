import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";
import { type Actor, PostingError, createPurchaseInvoice } from "./posting";
import { createScreenPurchase } from "@/lib/purchases/books-purchases";

const admin: Actor = { id: "u-admin", role: "ADMIN" };
let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  const paper = async (key: string, packCode: string, factor: string) => {
    const c = await db.component.create({ data: { sku: key, name: `AW ${key}`, categoryId: cat.id, unit: "sheet", dimensionX: 18, dimensionY: 25, gsm: 300 } });
    await db.itemUnitProfile.create({ data: { componentId: c.id, kind: "PAPER", baseUnit: "sheet", purchaseUnit: packCode, saleUnit: packCode, confirmed: true, conversions: { create: [{ code: packCode, factor }] } } as never });
    id[key] = c.id;
  };
  await paper("aw-rim", "rim", "100");
  await paper("aw-ream", "ream", "500");
  const sup = await db.supplier.create({ data: { name: "NAWAB" } });
  id.supplier = sup.id;
  id.supAcc = (await db.ledgerAccount.create({ data: { code: "S-NAWAB", name: "NAWAB", kind: "PARTY", subType: "SUPPLIER", supplierId: sup.id } })).id;
});
afterAll(async () => cleanup?.());

const lineOf = async (docId: string, lineNo = 1) => db.accountingDocumentLine.findUniqueOrThrow({ where: { documentId_lineNo: { documentId: docId, lineNo } } });

describe("paper details on purchase lines (old Supplier Invoice)", () => {
  it("the old invoice's first line: 18 x 25, 300 g, Rs 135.5/kg, 199 rims of 100: kg per rim 8.7097, amount 234,852.10", async () => {
    const doc = await createPurchaseInvoice(db, admin, {
      date: "2026-10-30", partyAccountId: id.supAcc, vendorBillNo: "819",
      lines: [{ componentId: id["aw-rim"], quantity: 199, unit: "rim", unitPrice: "1180.1613", paper: { x: 18, y: 25, gsm: 300, ratePerKg: 135.5 } }],
    });
    const l = await lineOf(doc.id);
    expect([l.paperX, l.paperY, l.paperGsm, l.paperDivisor, l.ratePerKg]).toEqual(["18", "25", "300", "15500", "135.5"]);
    expect(Number(l.kgPerUnit)).toBeCloseTo(8.7097, 4);
    expect(l.baseQuantity).toBe("19900"); // T-Qty: 199 rims x 100 sheets
    expect(Number(l.amount)).toBeCloseTo(234852.0987, 3);
  });

  it("a ream of 500 sheets weighs five times a 100-sheet rim (OD-02); a line in loose sheets records kg per sheet", async () => {
    const doc = await createPurchaseInvoice(db, admin, {
      date: "2026-10-31", partyAccountId: id.supAcc,
      lines: [
        { componentId: id["aw-ream"], quantity: 2, unit: "ream", unitPrice: "5900.81", paper: { x: 18, y: 25, gsm: 300, ratePerKg: 135.5 } },
        { componentId: id["aw-rim"], quantity: 50, unit: "sheet", unitPrice: "11.80", paper: { x: 18, y: 25, gsm: 300 } },
      ],
    });
    expect(Number((await lineOf(doc.id, 1)).kgPerUnit)).toBeCloseTo(43.5484, 4);
    const sheets = await lineOf(doc.id, 2);
    expect(Number(sheets.kgPerUnit)).toBeCloseTo(0.087097, 6);
    expect(sheets.ratePerKg).toBeNull();
  });

  it("lines without paper details stay as before; a GSM of 0 is refused and nothing is saved", async () => {
    const plain = await createPurchaseInvoice(db, admin, { date: "2026-11-01", partyAccountId: id.supAcc, lines: [{ componentId: id["aw-rim"], quantity: 1, unit: "rim", unitPrice: 1000 }] });
    expect((await lineOf(plain.id)).kgPerUnit).toBeNull();
    const before = await db.accountingDocument.count();
    const err = await createPurchaseInvoice(db, admin, { date: "2026-11-01", partyAccountId: id.supAcc, lines: [{ componentId: id["aw-rim"], quantity: 1, unit: "rim", unitPrice: 1000, paper: { x: 18, y: 25, gsm: 0 } }] }).catch((e) => e);
    expect(err).toBeInstanceOf(PostingError);
    expect((err as Error).message).toMatch(/GSM must be more than 0/);
    expect(await db.accountingDocument.count()).toBe(before);
  });

  it("the Purchases screen keeps the details through to the bill", async () => {
    const r = await createScreenPurchase(db, admin, {
      date: "2026-11-02", supplierId: id.supplier,
      items: [{ componentId: id["aw-rim"], quantity: 188, unit: "rim", unitPrice: "1573.5484", paper: { x: 20, y: 30, gsm: 300, ratePerKg: 135.5 } }],
      requestId: "paper-screen-1",
    });
    const l = await lineOf((r as { document: { id: string } }).document.id);
    expect(Number(l.kgPerUnit)).toBeCloseTo(11.6129, 4);
    expect(l.ratePerKg).toBe("135.5");
  });
});

describe("kg bought report uses the size kept on the bill", () => {
  it("a line bought at 20 x 30 counts 11.6129 kg per 100 sheets, though the product card says 18 x 25", async () => {
    const { kgReport } = await import("./queries");
    const rows = await kgReport(db, { from: new Date("2026-11-02"), to: new Date("2026-11-02T23:59:59.999Z") }, "purchase");
    const row = rows.find((r) => r.item === "AW aw-rim");
    expect(row?.sheets).toBe("18800");
    expect(Number(row?.kg)).toBeCloseTo(2183.2258, 3); // 188 rims x 11.6129 kg
  });
});
