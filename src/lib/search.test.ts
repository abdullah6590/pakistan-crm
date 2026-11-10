import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { type Actor, amendDocument, cancelDocument, createPurchaseInvoice, createSaleInvoice } from "@/lib/accounting/posting";
import { SEARCH_GROUPS, searchAll, searchGroup } from "./search";

const admin: Actor = { id: "u-admin", role: "ADMIN" };
let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  const item = async (key: string, name: string, extra: Record<string, unknown> = {}) => {
    const c = await db.component.create({ data: { sku: key.toUpperCase(), name, categoryId: cat.id, ...extra } });
    await db.itemUnitProfile.create({ data: { componentId: c.id, kind: "PIECE", baseUnit: "piece", confirmed: true } as never });
    id[key] = c.id;
  };
  await item("box", "Box board", { size: "20x39", grams: 200, quantity: 60 });
  await item("rim", "Rim board", { size: "25x30", grams: 210 });
  await item("pct", "100% recycled board");
  // Ali: a customer and, separately, a supplier with the same name
  const ali = await db.customer.create({ data: { name: "Ali Traders", phone: "0300-1112223", city: "Lahore" } });
  const aliSup = await db.supplier.create({ data: { name: "Ali Paper Mill", contactPerson: "Bilal" } });
  await db.customer.create({ data: { name: "Sana Ali Store" } });
  for (let i = 0; i < 9; i++) await db.customer.create({ data: { name: `Customer ${i} Karachi` } });
  id.aliAcc = (await db.ledgerAccount.create({ data: { code: "C-ALI", name: "Ali Traders", kind: "PARTY", subType: "CUSTOMER", customerId: ali.id } })).id;
  id.supAcc = (await db.ledgerAccount.create({ data: { code: "S-ALI", name: "Ali Paper Mill", kind: "PARTY", subType: "SUPPLIER", supplierId: aliSup.id } })).id;
  id.ali = ali.id;
  id.aliSup = aliSup.id;
  await createPurchaseInvoice(db, admin, { date: "2026-10-01", partyAccountId: id.supAcc, vendorBillNo: "APM-77", lines: [{ componentId: id.box, quantity: 100, unitPrice: 10 }] });
  const sale = await createSaleInvoice(db, admin, { date: "2026-10-05", partyAccountId: id.aliAcc, lines: [{ componentId: id.box, quantity: 40, unitPrice: 25 }] });
  id.sale = sale.id;
  // The bill is corrected once: only the latest version is a search result
  id.saleR1 = ((await amendDocument(db, admin, sale.id, { date: "2026-10-05", partyAccountId: id.aliAcc, lines: [{ componentId: id.box, quantity: 30, unitPrice: 25 }] }, "fewer taken")) as { id: string }).id;
  const second = await createSaleInvoice(db, admin, { date: "2026-10-06", partyAccountId: id.aliAcc, lines: [{ componentId: id.box, quantity: 1, unitPrice: 25 }] });
  await cancelDocument(db, admin, second.id, "entered twice");
  id.cancelled = second.id;
});
afterAll(async () => cleanup?.());

describe("global search", () => {
  it("a person's name finds them as customer and supplier, and their bills", async () => {
    const r = await searchAll(db, "ali", SEARCH_GROUPS);
    const by = Object.fromEntries(r.groups.map((g) => [g.group, g.hits.map((h) => h.title)]));
    expect(by.customers).toEqual(["Ali Traders", "Sana Ali Store"]); // starts with first, then a word starts with
    expect(by.suppliers).toEqual(["Ali Paper Mill"]);
    expect(by.purchases).toEqual(["PI-0001"]);
    expect(by.sales).toContain("SI-0001/R1");
  });

  it("shows only the latest version of a corrected bill; a cancelled bill is marked", async () => {
    const sales = await searchGroup(db, "sales", "ali");
    const ids = sales.hits.map((h) => h.id);
    expect(ids).toContain(id.saleR1);
    expect(ids).not.toContain(id.sale);
    expect(sales.hits.find((h) => h.id === id.cancelled)?.badges).toEqual([{ text: "Cancelled", tone: "bad" }]);
    expect(sales.hits[0].date).toMatch(/^2026-10-0\dT/);
    expect(sales.hits.find((h) => h.id === id.saleR1)?.amount).toBe("Rs 750");
  });

  it("customer and supplier results say what is owed; products show size, grams and stock", async () => {
    const c = await searchGroup(db, "customers", "ali traders");
    expect(c.hits[0].badges).toEqual([{ text: "Owes Rs 750", tone: "warn" }]);
    const s = await searchGroup(db, "suppliers", "bilal"); // the contact person
    expect(s.hits[0].badges).toEqual([{ text: "You owe Rs 1,000", tone: "warn" }]);
    const p = await searchGroup(db, "products", "board");
    expect(p.hits.map((h) => h.title)).toEqual(["100% recycled board", "Box board  ·  20x39 · 200g", "Rim board  ·  25x30 · 210g"]);
    expect(p.hits[1].badges[0]).toEqual({ text: "Stock 130 piece", tone: "good" }); // 60 + 100 bought - 30 sold
  });

  it("finds a bill by its number or the supplier's bill number, and an exact match is the best match", async () => {
    expect((await searchGroup(db, "purchases", "apm-77")).hits.map((h) => h.title)).toEqual(["PI-0001"]);
    const r = await searchAll(db, "PI-0001", SEARCH_GROUPS);
    expect(r.best?.title).toBe("PI-0001");
    expect(r.best?.rank).toBe(0);
  });

  it("every word must match; % and _ are ordinary characters", async () => {
    expect((await searchGroup(db, "customers", "ali lahore")).hits.map((h) => h.title)).toEqual(["Ali Traders"]);
    expect((await searchGroup(db, "products", "100%")).hits.map((h) => h.title)).toEqual(["100% recycled board"]);
    expect((await searchGroup(db, "products", "b_x")).hits).toEqual([]);
  });

  it("pages: the first few, then Show more brings the rest without repeats", async () => {
    const first = await searchGroup(db, "customers", "karachi", 0, 4);
    const second = await searchGroup(db, "customers", "karachi", 4, 8);
    expect(first.hits).toHaveLength(4);
    expect(first.hasMore).toBe(true);
    expect(second.hits).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.hits, ...second.hits].map((h) => h.id)).size).toBe(9);
  });

  it("with nothing typed, one group is listed from the top by name, page by page (the ledger pickers)", async () => {
    const first = await searchGroup(db, "customers", "", 0, 8);
    expect(first.hits.map((h) => h.title)).toEqual(["Ali Traders", ...Array.from({ length: 7 }, (_, i) => `Customer ${i} Karachi`)]);
    expect(first.hasMore).toBe(true);
    const rest = await searchGroup(db, "customers", "", 8, 8);
    expect(rest.hits.map((h) => h.title)).toEqual(["Customer 7 Karachi", "Customer 8 Karachi", "Sana Ali Store"]);
    expect((await searchGroup(db, "suppliers", "", 0, 8)).hits.map((h) => h.title)).toEqual(["Ali Paper Mill"]);
  });
});
