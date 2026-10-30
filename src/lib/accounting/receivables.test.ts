// Report 28: payments linked to the invoices they pay. The owner's acceptance example, editing a part-paid invoice,
// credit, refunds, cancellations, duplicate submits and failed saves. Sales income must be posted exactly once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { toPlain, fromPaisa } from "@/lib/domain/decimal";
import { createTestDb } from "./test-db";
import { Actor, PostingError, accountBalance, amendDocument, cancelDocument, createPurchaseInvoice, createSaleInvoice } from "./posting";
import { applyCredit, invoicePayments, openInvoices, receivePayment, refundCredit, unappliedReceipts } from "./receivables";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let admin: Actor;
const id: Record<string, string> = {};

const bal = async (accountId: string) => toPlain(await accountBalance(db, accountId));
/** Total credited to sales income by every journal (postings minus reversals). */
async function salesIncome() {
  const acc = await db.ledgerAccount.findUniqueOrThrow({ where: { code: "SALES_REVENUE" } });
  const agg = await db.journalLine.aggregate({ where: { accountId: acc.id }, _sum: { creditPaisa: true, debitPaisa: true } });
  return toPlain(fromPaisa((agg._sum.creditPaisa ?? BigInt(0)) - (agg._sum.debitPaisa ?? BigInt(0))));
}
async function storeStock(componentId: string) {
  const main = await db.stockLocation.findUniqueOrThrow({ where: { code: "MAIN" } });
  return (await db.itemStockBalance.findUniqueOrThrow({ where: { componentId_locationId: { componentId, locationId: main.id } } })).onHand;
}
const invoiceOf = (party: string, qty: number, price: number, date = "2026-10-01") =>
  createSaleInvoice(db, admin, { date, partyAccountId: id[party], lines: [{ componentId: id.cup, quantity: qty, unitPrice: price }] });
async function expectRefused(p: Promise<unknown>, status: number, message: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PostingError);
  expect((err as PostingError).status).toBe(status);
  expect((err as Error).message).toMatch(message);
}

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  admin = { id: (await db.user.create({ data: { name: "admin", email: "admin@test.local", password: "x", role: "ADMIN" } })).id, role: "ADMIN" };
  const cat = await db.componentCategory.create({ data: { name: "Cups" } });
  const cup = await db.component.create({ data: { sku: "cup", name: "Paper cup", categoryId: cat.id } });
  await db.itemUnitProfile.create({ data: { componentId: cup.id, kind: "PIECE", baseUnit: "piece", confirmed: true } });
  id.cup = cup.id;
  for (const [key, kind, subType] of [["ali", "PARTY", "CUSTOMER"], ["bilal", "PARTY", "CUSTOMER"], ["supplier", "PARTY", "SUPPLIER"], ["cash", "CASH_BANK", "CASH"], ["bank", "CASH_BANK", "BANK"]]) {
    id[key] = (await db.ledgerAccount.create({ data: { code: key.toUpperCase(), name: key, kind, subType } })).id;
  }
  await createPurchaseInvoice(db, admin, { date: "2026-09-01", partyAccountId: id.supplier, lines: [{ componentId: id.cup, quantity: 1000, unitPrice: 600 }] });
});
afterAll(async () => cleanup());

describe("owner's acceptance example (Report 28 §8)", () => {
  it("Rs 100,000 paid as 30,000 + 20,000 + 50,000: remaining 70,000 → 50,000 → 0, status Paid, income posted once", async () => {
    const income0 = await salesIncome();
    const inv = await invoiceOf("ali", 100, 1000);
    expect(inv.total).toBe("100000");
    expect((await invoicePayments(db, inv.id)).status).toBe("UNPAID");

    const steps: [string, string, string, string][] = [["cash", "30000", "70000", "PARTIALLY_PAID"], ["bank", "20000", "50000", "PARTIALLY_PAID"], ["cash", "50000", "0", "PAID"]];
    const receiptNos: string[] = [];
    for (const [i, [acct, amount, remaining, status]] of steps.entries()) {
      const r = await receivePayment(db, admin, { partyAccountId: id.ali, cashAccountId: id[acct], date: `2026-10-0${i + 2}`, amount, allocations: [{ invoiceId: inv.id, amount }] });
      receiptNos.push(r.receipt.docNo);
      const p = await invoicePayments(db, inv.id);
      expect([p.remaining, p.status]).toEqual([remaining, status]);
    }
    expect(receiptNos).toEqual(["CRV-0001", "BRV-0001", "CRV-0002"]);
    const p = await invoicePayments(db, inv.id);
    expect(p.payments.map((x) => [x.receiptNo, x.amount])).toEqual([["CRV-0001", "30000"], ["BRV-0001", "20000"], ["CRV-0002", "50000"]]);
    expect(p.paid).toBe("100000");
    expect(await bal(id.ali)).toBe("0"); // the customer owes nothing
    expect(await salesIncome()).toBe(String(Number(income0) + 100000)); // the sale's income, once; receipts add none
    expect(await openInvoices(db, id.ali)).toEqual([]);
  });
});

describe("editing a part-paid invoice (amendment)", () => {
  it("raising the total keeps the first payment, recalculates what is owed and corrects stock; the old version is kept", async () => {
    const stockBefore = await storeStock(id.cup);
    const inv = await invoiceOf("bilal", 100, 1000);
    await receivePayment(db, admin, { partyAccountId: id.bilal, cashAccountId: id.cash, date: "2026-10-05", amount: "30000", allocations: [{ invoiceId: inv.id, amount: "30000" }] });
    const income0 = await salesIncome();

    const r1 = await amendDocument(db, admin, inv.id, { date: "2026-10-01", partyAccountId: id.bilal, lines: [{ componentId: id.cup, quantity: 120, unitPrice: 1000 }] }, "Customer took 120") as { id: string; docNo: string; total: string };
    expect(r1.docNo).toBe(`${inv.docNo}/R1`);
    const p = await invoicePayments(db, r1.id);
    expect([p.total, p.paid, p.remaining, p.status]).toEqual(["120000", "30000", "90000", "PARTIALLY_PAID"]);
    expect(Number(await storeStock(id.cup))).toBe(Number(stockBefore) - 120); // not -100 -120
    expect(await salesIncome()).toBe(String(Number(income0) - 100000 + 120000)); // old version reversed, new posted
    const old = await db.accountingDocument.findUniqueOrThrow({ where: { id: inv.id } });
    expect(old.status).toBe("CANCELLED");
    const oldAlloc = await db.paymentAllocation.findFirstOrThrow({ where: { debitDocId: inv.id } });
    expect(oldAlloc.releaseReason).toBe(`Moved to revision ${r1.docNo}`);
    const history = await db.auditLog.findMany({ where: { entityId: { in: [inv.id, r1.id] } }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["POST", "AMEND", "ALLOCATIONS_MOVED"]));
    expect(await bal(id.bilal)).toBe("90000");
  });

  it("lowering the total below what was paid: the excess becomes unapplied credit, which is refunded", async () => {
    const inv = await invoiceOf("bilal", 100, 1000, "2026-10-10");
    const r1 = await receivePayment(db, admin, { partyAccountId: id.bilal, cashAccountId: id.cash, date: "2026-10-11", amount: "30000", allocations: [{ invoiceId: inv.id, amount: "30000" }] });
    const r2 = await receivePayment(db, admin, { partyAccountId: id.bilal, cashAccountId: id.bank, date: "2026-10-12", amount: "20000", allocations: [{ invoiceId: inv.id, amount: "20000" }] });
    const balanceBefore = Number(await bal(id.bilal));

    const rev = await amendDocument(db, admin, inv.id, { date: "2026-10-10", partyAccountId: id.bilal, lines: [{ componentId: id.cup, quantity: 40, unitPrice: 1000 }] }, "Returned 60 before delivery") as { id: string };
    const p = await invoicePayments(db, rev.id);
    expect([p.total, p.paid, p.remaining, p.status]).toEqual(["40000", "40000", "0", "PAID"]);
    expect(p.payments.map((x) => [x.receiptNo, x.amount])).toEqual([[r1.receipt.docNo, "30000"], [r2.receipt.docNo, "10000"]]); // oldest first
    const credit = await unappliedReceipts(db, id.bilal);
    expect(credit.map((c) => [c.receipt.docNo, toPlain(c.unapplied)])).toEqual([[r2.receipt.docNo, "10000"]]);
    expect(Number(await bal(id.bilal))).toBe(balanceBefore - 60000);

    const refund = await refundCredit(db, admin, { partyAccountId: id.bilal, cashAccountId: id.cash, date: "2026-10-13", amount: "10000" });
    expect(refund.refund.docNo).toMatch(/^CPV-/);
    expect(await unappliedReceipts(db, id.bilal)).toEqual([]);
    expect(Number(await bal(id.bilal))).toBe(balanceBefore - 50000);

    // The receipt that funded the refund cannot be cancelled before the refund
    await expectRefused(cancelDocument(db, admin, r2.receipt.id, "wrong"), 409, /refunded .*cancel the refund first/);
    await cancelDocument(db, admin, refund.refund.id, "Refund entered by mistake");
    expect((await unappliedReceipts(db, id.bilal)).map((c) => toPlain(c.unapplied))).toEqual(["10000"]);
  });
});

describe("advances, credit, cancellations", () => {
  it("an advance with no invoice stays as credit and is applied later; applying twice by double click applies once", async () => {
    const adv = await receivePayment(db, admin, { partyAccountId: id.ali, cashAccountId: id.cash, date: "2026-10-15", amount: "25000", remarks: "Advance" });
    expect(adv.allocations).toEqual([]);
    const inv = await invoiceOf("ali", 50, 1000, "2026-10-16");
    const first = await applyCredit(db, admin, { receiptId: adv.receipt.id, invoiceId: inv.id, amount: "25000", requestId: "11111111-1111-4111-8111-111111111111" });
    const again = await applyCredit(db, admin, { receiptId: adv.receipt.id, invoiceId: inv.id, amount: "25000", requestId: "11111111-1111-4111-8111-111111111111" });
    expect([first.repeated, again.repeated, again.allocation.id]).toEqual([false, true, first.allocation.id]);
    const p = await invoicePayments(db, inv.id);
    expect([p.paid, p.remaining, p.status]).toEqual(["25000", "25000", "PARTIALLY_PAID"]);
  });

  it("cancelling an invoice turns its payments into credit; cancelling a receipt makes the invoice owed again", async () => {
    const inv = await invoiceOf("ali", 10, 1000, "2026-10-17");
    const r = await receivePayment(db, admin, { partyAccountId: id.ali, cashAccountId: id.cash, date: "2026-10-18", amount: "6000", allocations: [{ invoiceId: inv.id, amount: "6000" }] });
    await cancelDocument(db, admin, inv.id, "Wrong customer");
    const freed = (await unappliedReceipts(db, id.ali)).find((c) => c.receipt.id === r.receipt.id);
    expect(freed && toPlain(freed.unapplied)).toBe("6000");

    const inv2 = await invoiceOf("ali", 10, 1000, "2026-10-19");
    const r2 = await receivePayment(db, admin, { partyAccountId: id.ali, cashAccountId: id.cash, date: "2026-10-20", amount: "4000", allocations: [{ invoiceId: inv2.id, amount: "4000" }] });
    await cancelDocument(db, admin, r2.receipt.id, "Cheque bounced");
    const p = await invoicePayments(db, inv2.id);
    expect([p.paid, p.remaining, p.status]).toEqual(["0", "10000", "UNPAID"]);
  });
});

describe("safety", () => {
  it("a repeated submit returns the first receipt; two at the same moment still make one", async () => {
    const inv = await invoiceOf("bilal", 5, 1000, "2026-10-21");
    const input = { partyAccountId: id.bilal, cashAccountId: id.cash, date: "2026-10-21", amount: "5000", allocations: [{ invoiceId: inv.id, amount: "5000" }], requestId: "22222222-2222-4222-8222-222222222222" };
    const a = await receivePayment(db, admin, input);
    const b = await receivePayment(db, admin, input);
    expect([a.repeated, b.repeated, b.receipt.id]).toEqual([false, true, a.receipt.id]);

    const inv2 = await invoiceOf("bilal", 5, 1000, "2026-10-22");
    const twin = { ...input, date: "2026-10-22", allocations: [{ invoiceId: inv2.id, amount: "5000" }], requestId: "33333333-3333-4333-8333-333333333333" };
    const [x, y] = await Promise.all([receivePayment(db, admin, twin), receivePayment(db, admin, twin)]);
    expect(x.receipt.id).toBe(y.receipt.id);
    expect(await db.accountingDocument.count({ where: { commandId: twin.requestId } })).toBe(1);
    expect((await invoicePayments(db, inv2.id)).paid).toBe("5000");
  });

  it("a payment that fails a check saves nothing: no receipt, no allocation, no number used", async () => {
    const inv = await invoiceOf("ali", 10, 1000, "2026-10-23");
    const other = await invoiceOf("bilal", 10, 1000, "2026-10-23");
    const vouchers = await db.accountingDocument.count({ where: { type: "VOUCHER" } });
    const series = await db.documentSeries.findUnique({ where: { series: "CRV" } });
    const pay = (allocations: { invoiceId: string; amount: string }[], amount = "10000") =>
      receivePayment(db, admin, { partyAccountId: id.ali, cashAccountId: id.cash, date: "2026-10-23", amount, allocations });
    await expectRefused(pay([{ invoiceId: inv.id, amount: "12000" }], "12000"), 400, /only 10000 is still owed/);
    await expectRefused(pay([{ invoiceId: inv.id, amount: "10000" }], "8000"), 400, /add up to more than the 8000 received/);
    await expectRefused(pay([{ invoiceId: other.id, amount: "1000" }]), 400, /belongs to another customer/);
    await expectRefused(pay([{ invoiceId: inv.id, amount: "1000" }, { invoiceId: inv.id, amount: "1000" }]), 400, /listed twice/);
    expect(await db.accountingDocument.count({ where: { type: "VOUCHER" } })).toBe(vouchers);
    expect((await db.documentSeries.findUnique({ where: { series: "CRV" } }))?.nextNumber).toBe(series?.nextNumber);
    expect((await invoicePayments(db, inv.id)).paid).toBe("0");
  });

  it("allocations cannot be deleted or rewritten in the database", async () => {
    const row = await db.paymentAllocation.findFirstOrThrow({ where: { releasedAt: null } });
    await expect(db.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE id = '${row.id}'`)).rejects.toThrow(/never deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE payment_allocations SET amount = '1' WHERE id = '${row.id}'`)).rejects.toThrow(/only be released/);
  });
});
