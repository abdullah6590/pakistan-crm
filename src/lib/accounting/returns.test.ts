// Returns (D-08) and stock counts (D-09) on an isolated database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { toPlain, fromPaisa, dec } from "@/lib/domain/decimal";
import { createTestDb } from "./test-db";
import {
  Actor, PostingError, accountBalance, approveDocument, cancelDocument, createCashSale, createPurchaseInvoice, createPurchaseReturn,
  createSaleInvoice, createSaleReturn, createStockAdjustment,
} from "./posting";
import { trialBalance, profitReport, daybook, negativeStockExceptions, kgReport, lastPrices } from "./queries";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};
const admin: Actor = { id: "u-admin", role: "ADMIN" };
const admin2: Actor = { id: "u-admin2", role: "ADMIN" };
const clerk: Actor = { id: "u-clerk", role: "EMPLOYEE" };
const storeman: Actor = { id: "u-store", role: "INVENTORY_MANAGER" };

const bal = async (accountId: string) => toPlain(await accountBalance(db, accountId));
const glBal = async (code: string) => bal((await db.ledgerAccount.findUniqueOrThrow({ where: { code } })).id);
const onHand = async (componentId: string) => (await db.itemStockBalance.findFirst({ where: { componentId } }))?.onHand ?? "0";
const journalOf = async (documentId: string) =>
  (await db.journalLine.findMany({ where: { entry: { documentId, kind: "POSTING" } }, include: { account: true } }))
    .map((l) => ({ code: l.account.code, dr: toPlain(fromPaisa(l.debitPaisa)), cr: toPlain(fromPaisa(l.creditPaisa)) }));
async function expectError(p: Promise<unknown>, status: number, message?: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PostingError);
  expect((err as PostingError).status).toBe(status);
  if (message) expect((err as Error).message).toMatch(message);
}

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Test" } });
  const paper = await db.component.create({ data: { sku: "paper", name: "Paper", categoryId: cat.id } });
  await db.itemUnitProfile.create({ data: { componentId: paper.id, kind: "PAPER", baseUnit: "sheet", confirmed: true, conversions: { create: [{ code: "packet", factor: "100" }] } } });
  const lids = await db.component.create({ data: { sku: "lids", name: "Lids", categoryId: cat.id } });
  await db.itemUnitProfile.create({ data: { componentId: lids.id, kind: "PIECE", baseUnit: "piece", confirmed: true } });
  id.paper = paper.id;
  id.lids = lids.id;
  for (const [key, kind, subType] of [["customer", "PARTY", "CUSTOMER"], ["supplier", "PARTY", "SUPPLIER"], ["cash", "CASH_BANK", "CASH"]]) {
    id[key] = (await db.ledgerAccount.create({ data: { code: key.toUpperCase(), name: key, kind, subType } })).id;
  }
  id.purchase = (await createPurchaseInvoice(db, storeman, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.paper, quantity: 10, unit: "packet", unitPrice: 1250 }, { componentId: id.lids, quantity: 100, unitPrice: 9 }] })).id;
  id.sale = (await createSaleInvoice(db, clerk, { date: "2026-10-02", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: 3, unit: "packet", loose: 25, unitPrice: 1250 }] })).id;
});

afterAll(async () => {
  await cleanup?.();
});

describe("returns (D-08)", () => {
  it("sale return: customer credited, revenue reduced through Sales returns, stock back at its original cost", async () => {
    const r = await createSaleReturn(db, clerk, { date: "2026-10-03", originalDocumentId: id.sale, lines: [{ lineNo: 1, quantity: 1, unit: "packet" }] });
    expect([r.docNo, r.total, r.previousBalance, r.newBalance, r.returnOfId]).toEqual(["SR-0001", "1250", "4062", "2812", id.sale]);
    expect(await journalOf(r.id)).toEqual(expect.arrayContaining([
      { code: "SALES_RETURNS", dr: "1250", cr: "0" },
      { code: "CUSTOMER", dr: "0", cr: "1250" },
      { code: "INVENTORY", dr: "1250", cr: "0" },
      { code: "COST_OF_GOODS_SOLD", dr: "0", cr: "1250" },
    ]));
    expect(await onHand(id.paper)).toBe("775");
    expect((await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.paper } })).averageCost).toBe("12.5");
  });

  it("loose returns use the original price per sheet and round like the sale; over-returns are refused", async () => {
    const r = await createSaleReturn(db, clerk, { date: "2026-10-03", originalDocumentId: id.sale, lines: [{ lineNo: 1, quantity: 25, unit: "sheet" }] });
    expect([r.exactTotal, r.total]).toEqual(["312.5", "312"]); // half-to-even, as the sale (OD-01)
    await expectError(createSaleReturn(db, clerk, { date: "2026-10-03", originalDocumentId: id.sale, lines: [{ lineNo: 1, quantity: 201, unit: "sheet" }] }), 400, /only 200 sheet/);
    await expectError(createSaleReturn(db, clerk, { date: "2026-10-03", originalDocumentId: id.sale, lines: [{ lineNo: 9, quantity: 1 }] }), 400, /not on/);
    await expectError(createSaleReturn(db, clerk, { date: "2026-10-03", originalDocumentId: id.purchase, lines: [{ lineNo: 1, quantity: 1 }] }), 400);
  });

  it("cash-sale return refunds from cash; cancelling a return restores what can be returned", async () => {
    const cs = await createCashSale(db, clerk, { date: "2026-10-04", cashAccountId: id.cash, lines: [{ componentId: id.lids, quantity: 10, unitPrice: 15 }] });
    const cashBefore = await bal(id.cash);
    const r = await createSaleReturn(db, clerk, { date: "2026-10-04", originalDocumentId: cs.id, refundAccountId: id.cash, lines: [{ lineNo: 1, quantity: 4 }] });
    expect(await journalOf(r.id)).toEqual(expect.arrayContaining([{ code: "CASH", dr: "0", cr: "60" }]));
    expect(Number(await bal(id.cash)) - Number(cashBefore)).toBe(-60);
    await expectError(createSaleReturn(db, clerk, { date: "2026-10-04", originalDocumentId: cs.id, lines: [{ lineNo: 1, quantity: 1 }] }), 400, /refund is paid from/);
    await cancelDocument(db, admin, r.id, "Customer kept the lids");
    expect(await bal(id.cash)).toBe(cashBefore);
    const again = await createSaleReturn(db, clerk, { date: "2026-10-04", originalDocumentId: cs.id, refundAccountId: id.cash, lines: [{ lineNo: 1, quantity: 10 }] });
    expect(again.total).toBe("150");
  });

  it("purchase return: supplier debited, stock leaves at its purchase value, average cost unchanged", async () => {
    const supplierBefore = await bal(id.supplier);
    const r = await createPurchaseReturn(db, storeman, { date: "2026-10-05", originalDocumentId: id.purchase, lines: [{ lineNo: 1, quantity: 2, unit: "packet" }] });
    expect(await journalOf(r.id)).toEqual(expect.arrayContaining([{ code: "SUPPLIER", dr: "2500", cr: "0" }, { code: "INVENTORY", dr: "0", cr: "2500" }]));
    expect(Number(await bal(id.supplier)) - Number(supplierBefore)).toBe(2500);
    expect(await onHand(id.paper)).toBe("600");
    expect((await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.paper } })).averageCost).toBe("12.5");
    await expectError(createPurchaseReturn(db, storeman, { date: "2026-10-05", originalDocumentId: id.purchase, lines: [{ lineNo: 1, quantity: 801, unit: "sheet" }] }), 400, /only 800/);
  });
});

describe("stock count (D-09)", () => {
  it("count waits for approval by another administrator; shortage at cost, gain at average cost", async () => {
    const count = await createStockAdjustment(db, admin, {
      date: "2026-10-06", remarks: "Year-end count by store staff",
      lines: [{ componentId: id.paper, quantity: 5, unit: "packet", loose: 90 }, { componentId: id.lids, quantity: 105 }],
    });
    expect(count.status).toBe("PENDING_APPROVAL");
    expect(await db.stockMovement.count({ where: { documentId: count.id } })).toBe(0);
    await expectError(approveDocument(db, admin, count.id), 403, /separation of duties/);
    const posted = await approveDocument(db, admin2, count.id);
    expect(posted.status).toBe("POSTED");
    const lines = await db.accountingDocumentLine.findMany({ where: { documentId: count.id }, orderBy: { lineNo: "asc" } });
    // paper: book 600, counted 590 -> 10 short at 12.5; lids: book 100 - 10 sold + 10 returned... = 100, counted 105 -> 5 gained at 9
    expect(lines.map((l) => [l.baseQuantity, l.bookQuantity, l.costAmount])).toEqual([["590", "600", "125"], ["105", "100", "45"]]);
    expect(await journalOf(count.id)).toEqual(expect.arrayContaining([
      { code: "STOCK_LOSS", dr: "125", cr: "0" },
      { code: "INVENTORY", dr: "45", cr: "0" },
      { code: "STOCK_GAIN", dr: "0", cr: "45" },
    ]));
    expect(await onHand(id.paper)).toBe("590");
  });

  it("books still balance and stock value still equals the inventory account", async () => {
    expect((await trialBalance(db)).balanced).toBe(true);
    const moved = (await db.stockMovement.findMany({ where: { costAmount: { not: null } } }))
      .filter((m) => !m.kind.startsWith("RELOCATE")).reduce((a, m) => a + dec(m.costAmount!), dec(0));
    expect(toPlain(moved)).toBe(await glBal("INVENTORY"));
  });
});

describe("reports R-04..R-07 and last prices (BR-10)", () => {
  it("profit nets returns and shows cost status; daybook balances; kg and exceptions; last prices", async () => {
    const byItem = await profitReport(db, {}, "item");
    expect(byItem.rows.map((r) => [r.label, r.revenue, r.cost, r.profit])).toEqual([["Lids", "0", "0", "0"], ["Paper", "2500", "2500", "0"]]);
    expect([byItem.revenue, byItem.revenueWithoutCost]).toEqual(["2500", "0"]);
    const byDoc = await profitReport(db, {}, "document");
    expect(byDoc.rows.find((r) => r.label === "SI-0001")?.revenue).toBe("4062.5");

    const book = await daybook(db, { from: new Date("2026-10-03"), to: new Date("2026-10-03T23:59:59Z") });
    expect(book.rows.map((r) => r.docNo)).toEqual(["SR-0001", "SR-0002"]);
    expect(book.debitTotal).toBe(book.creditTotal);

    expect((await negativeStockExceptions(db)).events).toEqual([]);
    const kg = await kgReport(db, {}, "sale");
    expect(kg.map((k) => [k.item, k.party, k.sheets])).toEqual([["Paper", "customer", "325"]]);

    const lids = await lastPrices(db, id.lids);
    expect([lids.purchase?.unitPrice, lids.sale?.unitPrice]).toEqual(["9", "15"]);
    const paper = await lastPrices(db, id.paper);
    expect([paper.purchase?.unitPrice, paper.purchase?.unit, paper.sale]).toEqual(["1250", "packet", null]); // paper sale rates are typed (BR-10)
  });
});
