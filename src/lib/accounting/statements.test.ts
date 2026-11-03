import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "./test-db";
import { type Actor, createPurchaseInvoice, createSaleInvoice, createVoucher } from "./posting";
import { trialBalance } from "./queries";
import { balanceSheet, profitAndLoss } from "./statements";

const admin: Actor = { id: "u-admin", role: "ADMIN" };
let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};
const day = (d: string, end = false) => new Date(end ? `${d}T23:59:59.999Z` : d);

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Test" } });
  const item = await db.component.create({ data: { sku: "BOX", name: "Box board", categoryId: cat.id } });
  await db.itemUnitProfile.create({ data: { componentId: item.id, kind: "PIECE", baseUnit: "piece", confirmed: true } as never });
  id.item = item.id;
  for (const [key, kind, subType] of [["customer", "PARTY", "CUSTOMER"], ["supplier", "PARTY", "SUPPLIER"], ["cash", "CASH_BANK", "CASH"]]) {
    id[key] = (await db.ledgerAccount.create({ data: { code: key.toUpperCase(), name: key, kind, subType } })).id;
  }
  // October: buy 100 at Rs 10, sell 40 at Rs 25, receive Rs 300 cash
  await createPurchaseInvoice(db, admin, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.item, quantity: 100, unitPrice: 10 }] });
  await createSaleInvoice(db, admin, { date: "2026-10-05", partyAccountId: id.customer, lines: [{ componentId: id.item, quantity: 40, unitPrice: 25 }] });
  await createVoucher(db, admin, { series: "CRV", date: "2026-10-06", debitAccountId: id.cash, creditAccountId: id.customer, amount: 300 });
  // November: sell 10 more at Rs 30
  await createSaleInvoice(db, admin, { date: "2026-11-02", partyAccountId: id.customer, lines: [{ componentId: id.item, quantity: 10, unitPrice: 30 }] });
});
afterAll(async () => cleanup?.());

describe("Profit & Loss", () => {
  it("for October: sales 1,000 less cost 400 = gross and net profit 600", async () => {
    const pl = await profitAndLoss(db, { from: day("2026-10-01"), to: day("2026-10-31", true) });
    expect(pl.sales.total).toBe("1000");
    expect(pl.cogs.total).toBe("400");
    expect(pl.grossProfit).toBe("600");
    expect(pl.expenses.lines).toEqual([]);
    expect(pl.netProfit).toBe("600");
    expect(pl.sales.lines.map((l) => l.code)).toEqual(["SALES_REVENUE"]);
  });

  it("only counts the chosen period: November is 300 sales less 100 cost", async () => {
    const pl = await profitAndLoss(db, { from: day("2026-11-01"), to: day("2026-11-30", true) });
    expect([pl.sales.total, pl.cogs.total, pl.netProfit]).toEqual(["300", "100", "200"]);
  });
});

describe("Balance Sheet", () => {
  it("at the end of October: cash 300 + stock 600 + customer 700 = supplier 1,000 + profit 600", async () => {
    const bs = await balanceSheet(db, day("2026-10-31", true));
    const g = (key: string) => [...bs.assets, ...bs.liabilities].find((x) => x.key === key)?.total;
    expect([g("cash-bank"), g("stock"), g("receivables")]).toEqual(["300", "600", "700"]);
    expect(g("payables")).toBe("1000");
    expect([bs.assetsTotal, bs.liabilitiesTotal, bs.profitToDate, bs.equityTotal]).toEqual(["1600", "1000", "600", "600"]);
    expect(bs.balanced).toBe(true);
  });

  it("always balances and agrees with the trial balance, including later entries", async () => {
    const bs = await balanceSheet(db);
    const tb = await trialBalance(db);
    expect(bs.balanced).toBe(true);
    expect(tb.balanced).toBe(true);
    expect(bs.profitToDate).toBe("800");
  });

  it("a supplier paid more than owed shows as an advance (asset), not a negative payable", async () => {
    const bank = (await db.ledgerAccount.create({ data: { code: "BANK", name: "bank", kind: "CASH_BANK", subType: "BANK" } })).id;
    await createVoucher(db, admin, { series: "BRV", date: "2026-11-03", debitAccountId: bank, creditAccountId: id.customer, amount: 2000 });
    await createVoucher(db, admin, { series: "BPV", date: "2026-11-04", debitAccountId: id.supplier, creditAccountId: bank, amount: 1500 });
    const bs = await balanceSheet(db);
    const keys = (gs: { key: string; total: string }[]) => Object.fromEntries(gs.map((x) => [x.key, x.total]));
    expect(keys(bs.assets)["supplier-advances"]).toBe("500");
    expect(keys(bs.liabilities).payables).toBeUndefined();
    expect(keys(bs.liabilities)["customer-advances"]).toBe("1000"); // billed 1,000 + 300, paid 300 + 2,000
    expect(bs.balanced).toBe(true);
  });
});
