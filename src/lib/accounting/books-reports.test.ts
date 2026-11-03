import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";
import { type Actor, createPurchaseInvoice, createSaleInvoice, createVoucher } from "./posting";
import { cashBook, moneySummary, partyBalances } from "./books-reports";
import { profitReport } from "./queries";

const admin: Actor = { id: "u-admin", role: "ADMIN" };
let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Test" } });
  const item = await db.component.create({ data: { sku: "BOX", name: "Box board", categoryId: cat.id } });
  await db.itemUnitProfile.create({ data: { componentId: item.id, kind: "PIECE", baseUnit: "piece", confirmed: true } as never });
  id.item = item.id;
  for (const [key, name, kind, subType] of [["a", "Ali Traders", "PARTY", "CUSTOMER"], ["b", "Bilal Store", "PARTY", "CUSTOMER"], ["s", "Star Mill", "PARTY", "SUPPLIER"], ["cash", "Cash in hand", "CASH_BANK", "CASH"]]) {
    id[key] = (await db.ledgerAccount.create({ data: { code: key.toUpperCase(), name, kind, subType, phone: key === "a" ? "0300-1234567" : null } })).id;
  }
  await createPurchaseInvoice(db, admin, { date: "2026-10-01", partyAccountId: id.s, lines: [{ componentId: id.item, quantity: 100, unitPrice: 10 }] });
  await createSaleInvoice(db, admin, { date: "2026-10-05", partyAccountId: id.a, lines: [{ componentId: id.item, quantity: 40, unitPrice: 25 }] });
  await createSaleInvoice(db, admin, { date: "2026-10-05", partyAccountId: id.b, lines: [{ componentId: id.item, quantity: 2, unitPrice: 25 }] });
  await createVoucher(db, admin, { series: "CRV", date: "2026-10-06", debitAccountId: id.cash, creditAccountId: id.a, amount: 300 });
  await createVoucher(db, admin, { series: "CPV", date: "2026-10-07", debitAccountId: id.s, creditAccountId: id.cash, amount: 200 });
});
afterAll(async () => cleanup?.());

describe("cash book", () => {
  it("one section per day: opening, in, out, closing, and who the money came from or went to", async () => {
    const book = await cashBook(db, id.cash);
    expect(book?.opening).toBe("0");
    expect(book?.days.map((d) => [d.date, d.opening, d.in, d.out, d.closing])).toEqual([
      ["2026-10-06", "0", "300", "0", "300"],
      ["2026-10-07", "300", "0", "200", "100"],
    ]);
    expect(book?.days[0].entries[0]).toMatchObject({ particulars: "Ali Traders", in: "300", out: "0" });
    expect(book?.days[1].entries[0]).toMatchObject({ particulars: "Star Mill", out: "200" });
    expect([book?.totalIn, book?.totalOut, book?.closing]).toEqual(["300", "200", "100"]);
  });

  it("from a later date it starts with the balance carried forward", async () => {
    const book = await cashBook(db, id.cash, { from: new Date("2026-10-07") });
    expect(book?.opening).toBe("300");
    expect(book?.days.map((d) => d.date)).toEqual(["2026-10-07"]);
    expect(book?.closing).toBe("100");
  });

  it("only for cash and bank accounts", async () => {
    expect(await cashBook(db, id.a)).toBeNull();
  });
});

describe("party balances", () => {
  it("everyone with a balance: customers who owe you (debit) and suppliers you owe (credit)", async () => {
    const all = await partyBalances(db);
    expect(all.rows.map((r) => [r.name, r.balance])).toEqual([["Ali Traders", "700"], ["Bilal Store", "50"], ["Star Mill", "-800"]]);
    expect(all.rows[0].phone).toBe("0300-1234567");
    expect([all.owedToYou, all.youOwe, all.net]).toEqual(["750", "800", "-50"]);
  });

  it("only balances above a minimum, and only customers or only suppliers", async () => {
    expect((await partyBalances(db, { minimum: 100 })).rows.map((r) => r.name)).toEqual(["Ali Traders", "Star Mill"]);
    expect((await partyBalances(db, { type: "CUSTOMER" })).rows.map((r) => r.name)).toEqual(["Ali Traders", "Bilal Store"]);
    expect((await partyBalances(db, { type: "SUPPLIER" })).youOwe).toBe("800");
  });

  it("as on an earlier date: before the receipt and payment", async () => {
    const early = await partyBalances(db, { asOf: new Date("2026-10-05T23:59:59.999Z") });
    expect(early.rows.map((r) => [r.name, r.balance])).toEqual([["Ali Traders", "1000"], ["Bilal Store", "50"], ["Star Mill", "-1000"]]);
  });
});

describe("profit by customer", () => {
  it("groups sales and cost by customer", async () => {
    const p = await profitReport(db, {}, "customer");
    expect(p.rows.map((r) => [r.label, r.revenue, r.cost, r.profit])).toEqual([["Ali Traders", "1000", "400", "600"], ["Bilal Store", "50", "20", "30"]]);
  });
});

describe("dashboard money summary", () => {
  it("cash in hand, bank, what customers owe and what you owe suppliers", async () => {
    expect(await moneySummary(db)).toEqual({ cash: "100", bank: "0", owedToYou: "750", youOwe: "800" });
  });
});
