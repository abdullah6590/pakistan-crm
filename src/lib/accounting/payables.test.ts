// Report 30: supplier payments linked to the purchase bills they settle. The owner's acceptance example (150,000 paid
// 50k / 40k / 60k), several bills in one payment, an advance used later, returns, a supplier refund, amendments,
// cancellations and duplicate submits. The purchase is posted once, by its bill; payments only settle the payable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { toPlain, fromPaisa } from "@/lib/domain/decimal";
import { createTestDb } from "./test-db";
import { Actor, PostingError, accountBalance, cancelDocument } from "./posting";
import { applySupplierCredit, billPayments, openBills, paySupplier, returnToSupplier, supplierCredit, supplierOpeningBalance, supplierRefund } from "./payables";
import { amendScreenPurchase, createScreenPurchase, partyForSupplier } from "@/lib/purchases/books-purchases";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let admin: Actor, clerk: Actor;
const id: Record<string, string> = {};

const bal = async (accountId: string) => toPlain(await accountBalance(db, accountId));
async function gl(code: string) {
  const acc = await db.ledgerAccount.findUniqueOrThrow({ where: { code } });
  const agg = await db.journalLine.aggregate({ where: { accountId: acc.id }, _sum: { debitPaisa: true, creditPaisa: true } });
  return toPlain(fromPaisa((agg._sum.debitPaisa ?? BigInt(0)) - (agg._sum.creditPaisa ?? BigInt(0))));
}
async function stock(componentId: string) {
  const main = await db.stockLocation.findUniqueOrThrow({ where: { code: "MAIN" } });
  return (await db.itemStockBalance.findUniqueOrThrow({ where: { componentId_locationId: { componentId, locationId: main.id } } })).onHand;
}
/** Every journal in the database balances (debits equal credits, entry by entry). */
async function journalsBalance() {
  const entries = await db.journalEntry.findMany({ include: { lines: true } });
  return entries.every((e) => e.lines.reduce((t, l) => t + l.debitPaisa - l.creditPaisa, BigInt(0)) === BigInt(0));
}
async function expectRefused(p: Promise<unknown>, status: number, message: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PostingError);
  expect((err as PostingError).status).toBe(status);
  expect((err as Error).message).toMatch(message);
}
const bill = (qty: number, price: number | string, extra: Record<string, unknown> = {}) =>
  createScreenPurchase(db, clerk, { date: "2026-10-01", supplierId: id.supplier, items: [{ componentId: id.board, quantity: qty, unitPrice: price }], ...extra });
const pay = (amount: number, allocations: { billId: string; amount: number }[], extra: Record<string, unknown> = {}) =>
  paySupplier(db, clerk, { partyAccountId: id.party, cashAccountId: id.cash, date: "2026-10-05", amount, allocations, ...extra });

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const mk = async (name: string, role: string) => ({ id: (await db.user.create({ data: { name, email: `${name}@test.local`, password: "x", role: role as never } })).id, role });
  admin = await mk("admin", "ADMIN");
  clerk = await mk("clerk", "INVENTORY_MANAGER");
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  const board = await db.component.create({ data: { sku: "BB", name: "Box board", categoryId: cat.id } });
  await db.itemUnitProfile.create({ data: { componentId: board.id, kind: "PIECE", baseUnit: "packet", confirmed: true } });
  id.board = board.id;
  id.supplier = (await db.supplier.create({ data: { name: "Paper Mill Ltd", phone: "0300-1234567" } })).id;
  id.party = (await db.$transaction((tx) => partyForSupplier(tx, id.supplier, admin.id))).id;
  id.cash = (await db.ledgerAccount.create({ data: { code: "CASH-1", name: "Cash in hand", kind: "CASH_BANK", subType: "CASH" } })).id;
  id.bank = (await db.ledgerAccount.create({ data: { code: "BANK-1", name: "Meezan Bank", kind: "CASH_BANK", subType: "BANK" } })).id;
});
afterAll(async () => cleanup());

describe("owner's example: a Rs 150,000 bill paid 50,000 + 40,000 + 60,000", () => {
  it("an unpaid bill: stock in at cost, the supplier is owed the total, nothing paid", async () => {
    const r = await bill(1000, 150, { vendorBillNo: "PM-771", dueDate: "2026-10-31" });
    id.bill = r.document.id;
    expect([r.document.total, r.document.vendorBillNo, r.payment]).toEqual(["150000", "PM-771", null]);
    expect(r.document.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-31");
    const p = await billPayments(db, id.bill);
    expect([p.paid, p.remaining, p.status]).toEqual(["0", "150000", "UNPAID"]);
    expect([await stock(id.board), await gl("INVENTORY"), await bal(id.party)]).toEqual(["1000", "150000", "-150000"]);
  });

  it("first payment 50,000 by bank: BPV, Rs 100,000 still payable", async () => {
    const r = await pay(50000, [{ billId: id.bill, amount: 50000 }], { cashAccountId: id.bank, reference: "TT-5531" });
    expect([r.payment.docNo, r.payment.vendorBillNo]).toEqual(["BPV-0001", "TT-5531"]);
    const p = await billPayments(db, id.bill);
    expect([p.paid, p.remaining, p.status]).toEqual(["50000", "100000", "PARTIALLY_PAID"]);
  });

  it("second payment 40,000 cash: CPV, Rs 60,000 still payable", async () => {
    const r = await pay(40000, [{ billId: id.bill, amount: 40000 }]);
    expect(r.payment.docNo).toBe("CPV-0001");
    expect((await billPayments(db, id.bill)).remaining).toBe("60000");
  });

  it("final 60,000: Paid; the purchase was posted once, cash and bank paid out 100,000 and 50,000", async () => {
    await pay(60000, [{ billId: id.bill, amount: 60000 }]);
    const p = await billPayments(db, id.bill);
    expect([p.paid, p.remaining, p.status, p.payments.length]).toEqual(["150000", "0", "PAID", 3]);
    expect([await bal(id.party), await gl("INVENTORY"), await bal(id.cash), await bal(id.bank)]).toEqual(["0", "150000", "-100000", "-50000"]);
    expect(await journalsBalance()).toBe(true);
  });

  it("over-paying a bill is refused, and nothing is saved", async () => {
    const before = await db.accountingDocument.count();
    await expectRefused(pay(1, [{ billId: id.bill, amount: 1 }]), 400, /only 0 is still payable/);
    expect(await db.accountingDocument.count()).toBe(before);
  });
});

describe("several bills, advances, paid now", () => {
  it("one payment split over two bills, explicitly; paisa kept on purchase totals", async () => {
    const a = (await bill(10, "1000.25")).document; // 10,002.50
    const b = (await bill(5, 2000)).document; // 10,000
    expect(a.total).toBe("10002.5");
    await pay(15002.5, [{ billId: a.id, amount: 10002.5 }, { billId: b.id, amount: 5000 }]);
    expect([(await billPayments(db, a.id)).status, (await billPayments(db, b.id)).remaining]).toEqual(["PAID", "5000"]);
    id.billB = b.id;
  });

  it("an advance with no bill stays the supplier's credit, and is applied to a bill later", async () => {
    const adv = await pay(7000, []);
    expect((await supplierCredit(db, id.party)).map((c) => toPlain(c.unapplied))).toEqual(["7000"]);
    await applySupplierCredit(db, clerk, { sourceId: adv.payment.id, billId: id.billB, amount: 5000 });
    expect((await billPayments(db, id.billB)).status).toBe("PAID");
    expect((await supplierCredit(db, id.party)).map((c) => toPlain(c.unapplied))).toEqual(["2000"]);
    id.advance = adv.payment.id;
  });

  it("a bill with part paid now gets a linked payment; a duplicate click makes nothing new", async () => {
    const requestId = "purchase-request-0001";
    const r = await bill(20, 500, { paidNow: { amount: "4000", method: "CASH", cashAccountId: id.cash }, requestId });
    const again = await bill(20, 500, { paidNow: { amount: "4000", method: "CASH", cashAccountId: id.cash }, requestId });
    expect(again.repeated).toBe(true);
    expect(again.document.id).toBe(r.document.id);
    const p = await billPayments(db, r.document.id);
    expect([p.paid, p.remaining, p.status, p.payments[0].docNo]).toEqual(["4000", "6000", "PARTIALLY_PAID", r.payment!.docNo]);
    expect(await db.accountingDocument.count({ where: { commandId: { startsWith: requestId } } })).toBe(2);
    id.billC = r.document.id;
  });

  it("the same supplier bill number cannot be entered twice", async () => {
    await expectRefused(bill(1, 1, { vendorBillNo: "PM-771" }), 409, /already entered as PI-0001/);
  });

  it("a repeated payment submit is answered with the first payment", async () => {
    const one = await pay(1000, [{ billId: id.billC, amount: 1000 }], { requestId: "pay-request-0001" });
    const two = await pay(1000, [{ billId: id.billC, amount: 1000 }], { requestId: "pay-request-0001" });
    expect([two.repeated, two.payment.id]).toEqual([true, one.payment.id]);
    expect((await billPayments(db, id.billC)).remaining).toBe("5000");
  });
});

describe("returns, refunds, amendments and cancellations", () => {
  it("returning goods on a part-paid bill settles it; stock and stock value leave at purchase cost", async () => {
    const stockBefore = Number(await stock(id.board));
    const r = await returnToSupplier(db, clerk, { date: "2026-10-06", originalDocumentId: id.billC, lines: [{ lineNo: 1, quantity: 4 }] });
    expect([r.purchaseReturn.total, r.settled, r.credit]).toEqual(["2000", "2000", "0"]);
    expect(Number(await stock(id.board))).toBe(stockBefore - 4);
    const p = await billPayments(db, id.billC);
    expect([p.paid, p.returned, p.remaining]).toEqual(["5000", "2000", "3000"]);
  });

  it("a bill with a return cannot be edited or cancelled until the return is cancelled", async () => {
    await expectRefused(cancelDocument(db, admin, id.billC, "wrong"), 409, /returned against this bill.*cancel the return first/);
  });

  it("returning goods on a fully paid bill leaves the supplier owing the business: refunded by the supplier", async () => {
    const r = await returnToSupplier(db, clerk, { date: "2026-10-07", originalDocumentId: id.bill, lines: [{ lineNo: 1, quantity: 10 }] });
    expect([r.settled, r.credit]).toEqual(["0", "1500"]);
    const credit = await supplierCredit(db, id.party);
    expect(credit.map((c) => `${c.source.docNo}:${toPlain(c.unapplied)}`)).toEqual([`${(await db.accountingDocument.findUniqueOrThrow({ where: { id: id.advance } })).docNo}:2000`, `${r.purchaseReturn.docNo}:1500`]);
    const refund = await supplierRefund(db, clerk, { partyAccountId: id.party, cashAccountId: id.cash, date: "2026-10-08", amount: 1500, fromSources: [{ sourceId: r.purchaseReturn.id, amount: 1500 }] });
    expect(refund.refund.docNo).toBe("CRV-0001");
    expect((await supplierCredit(db, id.party)).length).toBe(1);
    // A source that funded a refund cannot be cancelled before the refund
    await expectRefused(cancelDocument(db, admin, r.purchaseReturn.id, "wrong"), 409, /refunded .*cancel the refund first/);
  });

  it("editing a paid bill down: the new revision keeps what fits; the rest becomes the supplier's credit", async () => {
    const r = await bill(10, 1000); // 10,000
    await pay(10000, [{ billId: r.document.id, amount: 10000 }]);
    const out = await amendScreenPurchase(db, clerk, r.document.id, { supplierId: id.supplier, date: "2026-10-01", items: [{ componentId: id.board, quantity: 8, unitPrice: 1000 }] }, "Two packets were never delivered");
    expect(out.document.docNo).toMatch(/\/R1$/);
    expect(out.releasedCredit.map((c) => c.amount)).toEqual(["2000"]);
    const p = await billPayments(db, out.document.id);
    expect([p.total, p.paid, p.status]).toEqual(["8000", "8000", "PAID"]);
    expect((await billPayments(db, r.document.id)).status).toBe("REPLACED");
  });

  it("editing needs an administrator or the person who entered the bill", async () => {
    const other = { id: (await db.user.create({ data: { name: "other", email: "other@test.local", password: "x", role: "INVENTORY_MANAGER" } })).id, role: "INVENTORY_MANAGER" };
    await expectRefused(amendScreenPurchase(db, other, id.billB, { supplierId: id.supplier, items: [{ componentId: id.board, quantity: 5, unitPrice: 2000 }] }, "x"), 403, /administrator or the person/);
  });

  it("cancelling a payment makes its bill payable again; cancelling a bill makes its payments credit again", async () => {
    const b = (await bill(3, 1000)).document;
    const p = await pay(3000, [{ billId: b.id, amount: 3000 }]);
    await cancelDocument(db, admin, p.payment.id, "Entered twice by mistake");
    expect((await billPayments(db, b.id)).status).toBe("UNPAID");
    const p2 = await pay(3000, [{ billId: b.id, amount: 3000 }]);
    await cancelDocument(db, admin, b.id, "Goods sent back before unloading");
    expect((await billPayments(db, b.id)).status).toBe("CANCELLED");
    expect((await supplierCredit(db, id.party)).some((c) => c.source.id === p2.payment.id && toPlain(c.unapplied) === "3000")).toBe(true);
    expect((await openBills(db, id.party)).some((o) => o.bill.id === b.id)).toBe(false);
  });

  it("the supplier's balance equals bills less payments, returns and refunds, and every journal balances", async () => {
    const owed = (await openBills(db, id.party)).reduce((t, o) => t + Number(toPlain(o.remaining)), 0);
    const credit = (await supplierCredit(db, id.party)).reduce((t, c) => t + Number(toPlain(c.unapplied)), 0);
    expect(Number(await bal(id.party))).toBeCloseTo(-(owed - credit), 2);
    expect(await journalsBalance()).toBe(true);
  });
});

describe("opening balance", () => {
  it("entered once by an administrator with a reason; it can be paid like a bill", async () => {
    const s2 = (await db.supplier.create({ data: { name: "Glue House" } })).id;
    const party = (await db.$transaction((tx) => partyForSupplier(tx, s2, admin.id))).id;
    await expectRefused(supplierOpeningBalance(db, clerk, { partyAccountId: party, date: "2026-10-01", owed: 5000, reason: "From the old register, page 12" }), 403, /administrator/);
    await expectRefused(supplierOpeningBalance(db, admin, { partyAccountId: party, date: "2026-10-01", owed: 5000, reason: "old" }), 400, /at least 10/);
    const ob = await supplierOpeningBalance(db, admin, { partyAccountId: party, date: "2026-10-01", owed: 5000, reason: "From the old register, page 12" });
    await expectRefused(supplierOpeningBalance(db, admin, { partyAccountId: party, date: "2026-10-01", owed: 1, reason: "From the old register, again" }), 409, /already has an opening balance/);
    expect((await openBills(db, party)).map((o) => toPlain(o.remaining))).toEqual(["5000"]);
    await paySupplier(db, clerk, { partyAccountId: party, cashAccountId: id.cash, date: "2026-10-02", amount: 5000, allocations: [{ billId: ob.document.id, amount: 5000 }] });
    expect(await bal(party)).toBe("0");
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: ob.document.id, action: "OPENING_BALANCE" } })).reason).toBe("From the old register, page 12");
  });
});
