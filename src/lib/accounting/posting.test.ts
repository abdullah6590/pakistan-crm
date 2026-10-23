// End-to-end tests of the posting service on an isolated SQLite database built from the migrations.
// Each step builds on the previous one, like a day of trading: purchase, sales, receipts, cash sales,
// stock issues with approval, press work-in-progress, cancellation and amendment.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { toPlain, dec, fromPaisa } from "@/lib/domain/decimal";
import { createTestDb } from "./test-db";
import { setSetting } from "./setup";
import {
  Actor, PostingError, accountBalance, createPurchaseInvoice, createSaleInvoice, createCashSale, createVoucher, createTransfer,
  createOpeningBalance, createStockIssue, approveDocument, rejectDocument, createPressDispatch, createPressReceipt, createPressReturn,
  createPressLoss, cancelDocument, amendDocument,
} from "./posting";
import { accountStatement, trialBalance, stockReport, pressReport, pendingApprovals } from "./queries";

const admin: Actor = { id: "u-admin", role: "ADMIN" };
const storeman: Actor = { id: "u-store", role: "INVENTORY_MANAGER" };
const clerk: Actor = { id: "u-clerk", role: "EMPLOYEE" };

let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};

async function bal(accountId: string) {
  return toPlain(await accountBalance(db, accountId));
}
async function glBal(code: string) {
  const a = await db.ledgerAccount.findUniqueOrThrow({ where: { code } });
  return bal(a.id);
}
async function onHand(componentId: string, location = "MAIN") {
  const loc = await db.stockLocation.findUnique({ where: { code: location } });
  if (!loc) return "0";
  const row = await db.itemStockBalance.findUnique({ where: { componentId_locationId: { componentId, locationId: loc.id } } });
  return row?.onHand ?? "0";
}
async function journalOf(documentId: string) {
  const lines = await db.journalLine.findMany({ where: { entry: { documentId } }, include: { account: true } });
  return lines.map((l) => ({ code: l.account.code, dr: toPlain(fromPaisa(l.debitPaisa)), cr: toPlain(fromPaisa(l.creditPaisa)) }));
}
async function expectPostingError(p: Promise<unknown>, status: number, message?: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PostingError);
  expect((err as PostingError).status).toBe(status);
  if (message) expect((err as Error).message).toMatch(message);
}

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Test" } });
  const item = async (key: string, data: { name: string; unit?: string; dimensionX?: number; dimensionY?: number; gsm?: number }, profile?: Record<string, unknown>, conversions: { code: string; factor: string; decimals?: number }[] = []) => {
    const c = await db.component.create({ data: { sku: key, categoryId: cat.id, ...data } });
    if (profile) await db.itemUnitProfile.create({ data: { componentId: c.id, ...profile, conversions: { create: conversions } } as never });
    id[key] = c.id;
  };
  await item("paper", { name: "Art paper 20x30 80g", unit: "sheet", dimensionX: 20, dimensionY: 30, gsm: 80 }, { kind: "PAPER", baseUnit: "sheet", purchaseUnit: "packet", saleUnit: "packet", confirmed: true }, [{ code: "packet", factor: "100" }]);
  await item("cups", { name: "Paper cup 8oz" }, { kind: "PIECE", baseUnit: "piece", purchaseUnit: "carton", saleUnit: "carton", confirmed: true }, [{ code: "carton", factor: "2000" }]);
  await item("printed", { name: "Printed box" }, { kind: "PIECE", baseUnit: "piece", confirmed: true });
  await item("nocost", { name: "Item never purchased" }, { kind: "PIECE", baseUnit: "piece", confirmed: true });
  await item("refcost", { name: "Lid with reference price" }, { kind: "PIECE", baseUnit: "piece", confirmed: true, referencePurchasePrice: "9", referenceExpenses: "0" });
  const acct = async (key: string, kind: string, subType: string) => {
    id[key] = (await db.ledgerAccount.create({ data: { code: key.toUpperCase(), name: key, kind, subType } })).id;
  };
  await acct("customer", "PARTY", "CUSTOMER");
  await acct("supplier", "PARTY", "SUPPLIER");
  await acct("press", "PARTY", "PRESS");
  await acct("cash", "CASH_BANK", "CASH");
  await acct("bank", "CASH_BANK", "BANK");
});

afterAll(async () => {
  await cleanup?.();
});

describe("posting service (isolated database)", () => {
  it("purchase invoice: stock in at cost, supplier credited, blank bill dates stay empty (F-07)", async () => {
    const doc = await createPurchaseInvoice(db, admin, {
      date: "2026-10-01", partyAccountId: id.supplier, vendorBillNo: "VB-1", vendorBillDate: "", biltyDate: null,
      lines: [
        { componentId: id.paper, quantity: 10, unit: "packet", unitPrice: 1250 },
        { componentId: id.cups, quantity: 5, unit: "carton", unitPrice: 8261 }, // SC-08/09: 8250 + 11 per carton of 2000
      ],
    });
    expect(doc.docNo).toBe("PI-0001");
    expect([doc.total, doc.previousBalance, doc.newBalance]).toEqual(["53805", "0", "-53805"]);
    expect(doc.vendorBillDate).toBeNull();
    expect(doc.biltyDate).toBeNull();
    expect(await onHand(id.paper)).toBe("1000");
    expect(await onHand(id.cups)).toBe("10000");
    expect(await journalOf(doc.id)).toEqual(expect.arrayContaining([{ code: "INVENTORY", dr: "53805", cr: "0" }, { code: "SUPPLIER", dr: "0", cr: "53805" }]));
    const cost = await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.cups } });
    expect(cost.averageCost).toBe("4.1305");
  });

  it("sale invoice: packs + loose for paper and cartons, rounded total, rounding and cost of goods posted", async () => {
    const doc = await createSaleInvoice(db, clerk, {
      date: "2026-10-02", partyAccountId: id.customer,
      lines: [
        { componentId: id.paper, quantity: 3, unit: "packet", loose: 25, unitPrice: 1250 },
        { componentId: id.cups, quantity: 1, unit: "carton", loose: 500, unitPrice: 9000 },
      ],
    });
    expect(doc.docNo).toBe("SI-0001");
    expect([doc.exactTotal, doc.total, doc.roundingAdjustment]).toEqual(["15312.5", "15312", "-0.5"]);
    expect([doc.previousBalance, doc.newBalance]).toEqual(["0", "15312"]);
    expect(doc.lines.map((l) => [l.baseQuantity, l.loosePrice, l.amount, l.costAmount, l.costStatus])).toEqual([
      ["325", "12.5", "4062.5", "4062.5", "ACTUAL"],
      ["2500", "4.5", "11250", "10326.25", "ACTUAL"],
    ]);
    const j = await journalOf(doc.id);
    expect(j).toEqual(expect.arrayContaining([
      { code: "CUSTOMER", dr: "15312", cr: "0" },
      { code: "SALES_REVENUE", dr: "0", cr: "15312.5" },
      { code: "ROUNDING_ADJUSTMENT", dr: "0.5", cr: "0" },
      { code: "COST_OF_GOODS_SOLD", dr: "14388.75", cr: "0" },
      { code: "INVENTORY", dr: "0", cr: "14388.75" },
    ]));
    expect(await onHand(id.paper)).toBe("675");
    expect(await onHand(id.cups)).toBe("7500");
  });

  it("vouchers: separate CRV/BRV numbering, receipt rules enforced, party balance updated (F-04)", async () => {
    const crv = await createVoucher(db, admin, { series: "CRV", date: "2026-10-03", debitAccountId: id.cash, creditAccountId: id.customer, amount: 10000 });
    const brv = await createVoucher(db, admin, { series: "BRV", date: "2026-10-03", debitAccountId: id.bank, creditAccountId: id.customer, amount: 312 });
    expect([crv.docNo, brv.docNo]).toEqual(["CRV-0001", "BRV-0001"]);
    expect([crv.previousBalance, crv.newBalance, brv.newBalance]).toEqual(["15312", "5312", "5000"]);
    await expectPostingError(createVoucher(db, admin, { series: "CRV", date: "2026-10-03", debitAccountId: id.bank, creditAccountId: id.customer, amount: 1 }), 400, /cash receipt/);
    await expectPostingError(createVoucher(db, admin, { series: "JV", date: "2026-10-03", debitAccountId: id.customer, creditAccountId: id.cash, amount: 1 }), 400, /journal voucher/);
    await expectPostingError(createVoucher(db, admin, { series: "CPV", date: "2026-10-03", debitAccountId: id.supplier, creditAccountId: id.cash, amount: "1.005" }), 400, /2 decimal/);
    // OD-12: zero amount allowed only with a remark; it moves no money
    await expectPostingError(createVoucher(db, admin, { series: "CRV", date: "2026-10-03", debitAccountId: id.cash, creditAccountId: id.customer, amount: 0 }), 400, /remark/);
    const zero = await createVoucher(db, admin, { series: "CRV", date: "2026-10-03", debitAccountId: id.cash, creditAccountId: id.customer, amount: 0, remarks: "Cheque returned unpaid, recorded for reference" });
    expect([zero.docNo, zero.total, zero.newBalance]).toEqual(["CRV-0002", "0", "5000"]);
    expect(await db.journalEntry.count({ where: { documentId: zero.id } })).toBe(0);
    const cpv = await createVoucher(db, admin, { series: "CPV", date: "2026-10-03", debitAccountId: id.supplier, creditAccountId: id.cash, amount: 20000 });
    expect(cpv.newBalance).toBe("-33805");
    expect(await bal(id.cash)).toBe("-10000");
  });

  it("cash sales: paid in full, unpaid remainder charged to Counter Sale (F-03), over-payment refused without side effects", async () => {
    const paid = await createCashSale(db, clerk, { date: "2026-10-04", cashAccountId: id.cash, customerName: "Walk-in", lines: [{ componentId: id.paper, quantity: 1, unit: "packet", unitPrice: 1300 }] });
    expect([paid.docNo, paid.total, paid.amountReceived, paid.partyAccountId]).toEqual(["CS-0001", "1300", "1300", null]);
    const part = await createCashSale(db, clerk, { date: "2026-10-04", cashAccountId: id.cash, amountReceived: 2000, lines: [{ componentId: id.paper, quantity: 2, unit: "packet", unitPrice: "1300.4" }] });
    expect([part.exactTotal, part.total, part.newBalance]).toEqual(["2600.8", "2601", "601"]);
    expect(await glBal("COUNTER_SALE")).toBe("601");
    await expectPostingError(createCashSale(db, clerk, { date: "2026-10-04", cashAccountId: id.cash, amountReceived: 5000, lines: [{ componentId: id.paper, quantity: 1, unit: "packet", unitPrice: 1300 }] }), 400, /more than/);
    expect(await onHand(id.paper)).toBe("375"); // refused sale moved no stock
    const next = await createCashSale(db, clerk, { date: "2026-10-04", cashAccountId: id.cash, lines: [{ componentId: id.paper, quantity: 0, unit: "packet", loose: 10, unitPrice: 1300 }] });
    expect(next.docNo).toBe("CS-0003"); // refused attempt did not consume a number
    expect(next.total).toBe("130");
    expect(await onHand(id.paper)).toBe("365");
  });

  it("negative stock is allowed with a warning by default, cost reported as unavailable or estimated (OD-03/OD-04)", async () => {
    const doc = await createSaleInvoice(db, clerk, {
      date: "2026-10-05", partyAccountId: id.customer,
      lines: [{ componentId: id.nocost, quantity: 5, unitPrice: 100 }, { componentId: id.refcost, quantity: 10, unitPrice: 15 }],
    });
    expect(doc.hasNegativeStock).toBe(true);
    expect(doc.hasCostEstimate).toBe(true);
    expect(doc.lines.map((l) => [l.costStatus, l.costAmount])).toEqual([["UNAVAILABLE", null], ["ESTIMATED", "90"]]);
    expect(doc.lines[0].stockWarning).toMatch(/below zero/);
    expect(await onHand(id.nocost)).toBe("-5");
    await setSetting(db, "NEGATIVE_STOCK_POLICY", "BLOCK", admin.id);
    await expectPostingError(createSaleInvoice(db, clerk, { date: "2026-10-05", partyAccountId: id.customer, lines: [{ componentId: id.nocost, quantity: 1, unitPrice: 100 }] }), 409, /negative stock is blocked/);
    await setSetting(db, "NEGATIVE_STOCK_POLICY", "ALLOW_WITH_WARNING", admin.id);
    expect(await onHand(id.nocost)).toBe("-5");
  });

  it("stock issue waits for administrator approval and only then moves stock and cost", async () => {
    const issue = await createStockIssue(db, storeman, { date: "2026-10-06", reason: "INTERNAL_CONSUMPTION", remarks: "Office use", lines: [{ componentId: id.paper, quantity: 50 }] });
    expect([issue.docNo, issue.status, issue.createdById]).toEqual(["SIS-0001", "PENDING_APPROVAL", storeman.id]);
    expect(issue.submittedAt).toBeInstanceOf(Date);
    expect(await db.stockMovement.count({ where: { documentId: issue.id } })).toBe(0);
    expect(await db.journalEntry.count({ where: { documentId: issue.id } })).toBe(0);
    expect(await onHand(id.paper)).toBe("365");
    expect((await pendingApprovals(db)).map((d) => d.id)).toContain(issue.id);

    await expectPostingError(approveDocument(db, storeman, issue.id), 403);
    await expectPostingError(approveDocument(db, clerk, issue.id), 403);
    const posted = await approveDocument(db, admin, issue.id);
    expect([posted.status, posted.approvedById]).toEqual(["POSTED", admin.id]);
    expect(posted.approvedAt).toBeInstanceOf(Date);
    expect(posted.lines[0].costAmount).toBe("625");
    expect(await journalOf(issue.id)).toEqual(expect.arrayContaining([{ code: "INTERNAL_CONSUMPTION", dr: "625", cr: "0" }, { code: "INVENTORY", dr: "0", cr: "625" }]));
    expect(await onHand(id.paper)).toBe("315");
    await expectPostingError(approveDocument(db, admin, issue.id), 409);
    const actions = (await db.auditLog.findMany({ where: { entityId: issue.id }, orderBy: { createdAt: "asc" } })).map((a) => [a.action, a.userId]);
    expect(actions).toEqual([["SUBMIT", storeman.id], ["APPROVE", admin.id], ["POST", admin.id]]);
  });

  it("a rejected stock issue never posts", async () => {
    const issue = await createStockIssue(db, storeman, { date: "2026-10-06", reason: "DAMAGE", remarks: "Wet packet", lines: [{ componentId: id.paper, quantity: 1, unit: "packet" }] });
    await expectPostingError(rejectDocument(db, admin, issue.id, " "), 400);
    const rejected = await rejectDocument(db, admin, issue.id, "Not damaged");
    expect([rejected.status, rejected.rejectedById, rejected.rejectionReason]).toEqual(["REJECTED", admin.id, "Not damaged"]);
    await expectPostingError(approveDocument(db, admin, issue.id), 409);
    expect(await db.stockMovement.count({ where: { documentId: issue.id } })).toBe(0);
    expect(await onHand(id.paper)).toBe("315");
  });

  it("press work-in-progress: dispatch moves no money, printed goods carry material cost only, returns and approved losses reconcile (decision 2c)", async () => {
    const pd = await createPressDispatch(db, storeman, { date: "2026-10-07", pressAccountId: id.press, lines: [{ componentId: id.paper, quantity: 2, unit: "packet" }] });
    expect(pd.docNo).toBe("PD-0001");
    expect(await db.journalEntry.count({ where: { documentId: pd.id } })).toBe(0);
    expect(await bal(id.press)).toBe("0"); // the press is not charged on dispatch
    expect([await onHand(id.paper), await onHand(id.paper, "PRESS-PRESS")]).toEqual(["115", "200"]);

    const pr = await createPressReceipt(db, storeman, {
      date: "2026-10-08", pressAccountId: id.press,
      lines: [{ componentId: id.printed, quantity: 1000, consumedComponentId: id.paper, consumedQuantity: 150 }],
      charges: [{ kind: "PRINTING", amount: 3000, description: "Printing 1000 boxes" }],
    });
    expect(pr.lines[0].costAmount).toBe("1875"); // 150 sheets x 12.5; the printing charge is never added (2026-10-22 rule)
    expect(await journalOf(pr.id)).toEqual([]);
    expect(await bal(id.press)).toBe("0");
    const charge = await db.chargeRecord.findFirstOrThrow({ where: { documentId: pr.id } });
    expect([charge.kind, charge.amount, charge.status, charge.partyAccountId]).toEqual(["PRINTING", "3000", "RECORDED", id.press]);
    expect(await onHand(id.printed)).toBe("1000");

    await createPressReturn(db, storeman, { date: "2026-10-09", pressAccountId: id.press, lines: [{ componentId: id.paper, quantity: 30 }] });
    const loss = await createPressLoss(db, storeman, { date: "2026-10-09", pressAccountId: id.press, reason: "UNEXPLAINED_DIFFERENCE", remarks: "Count at press short by 20", lines: [{ componentId: id.paper, quantity: 20 }] });
    expect(loss.status).toBe("PENDING_APPROVAL");
    await approveDocument(db, admin, loss.id);
    expect(await journalOf(loss.id)).toEqual(expect.arrayContaining([{ code: "STOCK_LOSS", dr: "250", cr: "0" }]));
    const report = await pressReport(db, id.press);
    expect(report!.rows).toEqual([{ componentId: id.paper, name: "Art paper 20x30 80g", dispatched: "200", returned: "30", consumed: "150", lost: "20", heldAtPress: "0" }]);
    expect(await onHand(id.paper)).toBe("145");

    const sale = await createSaleInvoice(db, clerk, { date: "2026-10-10", partyAccountId: id.customer, lines: [{ componentId: id.printed, quantity: 500, unitPrice: 6 }] });
    expect(sale.lines[0].costAmount).toBe("937.5"); // 500 x 1.875 material cost per box
  });

  it("cancellation reverses stock, cost and balances; it needs a reason and happens once", async () => {
    const before = { paper: await onHand(id.paper), customer: await bal(id.customer) };
    const sale = await createSaleInvoice(db, clerk, { date: "2026-10-11", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: 1, unit: "packet", unitPrice: 1250 }] });
    expect(await onHand(id.paper)).toBe("45");
    await expectPostingError(cancelDocument(db, admin, sale.id, ""), 400);
    const cancelled = await cancelDocument(db, admin, sale.id, "Entered twice");
    expect([cancelled.status, cancelled.cancelledById, cancelled.cancelReason]).toEqual(["CANCELLED", admin.id, "Entered twice"]);
    expect({ paper: await onHand(id.paper), customer: await bal(id.customer) }).toEqual(before);
    expect((await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.paper } })).averageCost).toBe("12.5");
    await expectPostingError(cancelDocument(db, admin, sale.id, "again"), 409);
  });

  it("amendment keeps the invoice number as a new revision and keeps the old version (OD-11)", async () => {
    const before = await bal(id.customer);
    const sale = await createSaleInvoice(db, clerk, { date: "2026-10-12", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: 1, unit: "packet", unitPrice: 1250 }] });
    const amended = (await amendDocument(db, admin, sale.id, { date: "2026-10-12", partyAccountId: id.customer, lines: [{ componentId: id.paper, quantity: 1, unit: "packet", loose: 20, unitPrice: 1250 }] }, "Customer took 20 more sheets")) as { docNo: string; revision: number; supersedesId: string; total: string };
    expect(amended.docNo).toBe(`${sale.docNo}/R1`);
    expect([amended.revision, amended.supersedesId, amended.total]).toEqual([1, sale.id, "1500"]);
    expect((await db.accountingDocument.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe("CANCELLED");
    expect(await bal(id.customer)).toBe(toPlain(dec(before) + dec(1500)));
    expect(await onHand(id.paper)).toBe("25");
    const audit = await db.auditLog.findFirst({ where: { entityId: sale.id, action: "AMEND" } });
    expect(audit?.reason).toBe("Amended: Customer took 20 more sheets");
  });

  it("transfers and opening balances post balanced entries", async () => {
    await createTransfer(db, admin, { date: "2026-10-13", fromAccountId: id.cash, toAccountId: id.bank, amount: 1000 });
    await expectPostingError(createTransfer(db, admin, { date: "2026-10-13", fromAccountId: id.cash, toAccountId: id.customer, amount: 1 }), 400);
    const ob = await createOpeningBalance(db, admin, { date: "2026-09-30", accountId: id.supplier, credit: 1000 });
    expect([ob.previousBalance, ob.newBalance]).toEqual(["0", "-1000"]); // as at its own date
    await expectPostingError(createOpeningBalance(db, admin, { date: "2026-09-30", accountId: id.supplier, debit: 1, credit: 1 }), 400);
  });

  it("20 simultaneous postings receive 20 unique, consecutive numbers (C-04)", async () => {
    const docs = await Promise.all(Array.from({ length: 20 }, () =>
      createVoucher(db, admin, { series: "JV", date: "2026-10-14", debitAccountId: id.customer, creditAccountId: id.supplier, amount: 1 })));
    const numbers = docs.map((d) => d.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("books balance, stock value matches the inventory account, and the statement agrees with the balance", async () => {
    const tb = await trialBalance(db);
    expect(tb.balanced).toBe(true);
    const moves = await db.stockMovement.findMany({ where: { kind: { not: "RELOCATE" }, costAmount: { not: null } } });
    const relocations = await db.stockMovement.findMany({ where: { kind: { in: ["RELOCATE", "RELOCATE_REVERSAL"] } } });
    expect(relocations.length).toBeGreaterThan(0);
    const movedValue = moves.filter((m) => !m.kind.startsWith("RELOCATE")).reduce((a, m) => a + dec(m.costAmount!), BigInt(0));
    expect(toPlain(movedValue)).toBe(await glBal("INVENTORY"));

    const st = await accountStatement(db, id.customer);
    expect(st!.closing).toBe(await bal(id.customer));
    const first = st!.rows.find((r) => r.docNo === "SI-0001")!;
    expect(first.items.map((i) => [i.quantity, i.unit, i.loose, i.amount])).toEqual([["3", "packet", "25", "4062.5"], ["1", "carton", "500", "11250"]]);

    const stock = await stockReport(db, { locationCode: "MAIN" });
    const paper = stock.rows.find((r) => r.componentId === id.paper)!;
    expect([paper.onHand, paper.packs, paper.averageCost, paper.value]).toEqual(["25", { unit: "packet", perPack: "100", packs: "0", loose: "25" }, "12.5", "312.5"]);
    expect(stock.rows.find((r) => r.componentId === id.nocost)!.negative).toBe(true);
  });
});
