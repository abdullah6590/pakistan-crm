// Phase 2 (Report 33): a part-paid cash sale owes its rest on the same bill and is settled later by a receipt
// allocated to it (the old Cash Update), without editing the bill; walk-in name and phone and line remarks are kept;
// an edited bill keeps every row that was added and drops every row that was removed (the old program did not).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "../accounting/test-db";
import { Actor, PostingError, createPurchaseInvoice } from "../accounting/posting";
import { invoicePayments, openInvoices, receivePayment } from "../accounting/receivables";
import { amendScreenSale, createScreenSale } from "./books-sales";
import { loadBooksBill } from "./books-queries";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const admin: Actor = { id: "u-admin", role: "ADMIN" };
const id: Record<string, string> = {};
const err = async (p: Promise<unknown>) => p.then(() => null, (e: PostingError) => ({ status: e.status, message: e.message }));

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  for (const k of ["a", "b", "c"]) {
    const c = await db.component.create({ data: { sku: k, name: `item ${k}`, categoryId: cat.id, unit: "sheet" } });
    await db.itemUnitProfile.create({ data: { componentId: c.id, kind: "PAPER", baseUnit: "sheet", purchaseUnit: "packet", saleUnit: "packet", confirmed: true, conversions: { create: [{ code: "packet", factor: "100" }] } } as never });
    id[k] = c.id;
  }
  const supplier = (await db.ledgerAccount.create({ data: { code: "SUP", name: "Mill", kind: "PARTY", subType: "SUPPLIER" } })).id;
  await createPurchaseInvoice(db, admin, { date: "2026-11-01", partyAccountId: supplier, lines: ["a", "b", "c"].map((k) => ({ componentId: id[k], quantity: 50, unit: "packet", unitPrice: "1000" })) });
  id.customer = (await db.customer.create({ data: { name: "Power Press" } })).id;
});
afterAll(async () => cleanup());

describe("cash sale paid in part, settled later (old Cash Update)", () => {
  it("keeps the walk-in name and phone and the line remarks; the unpaid rest stays on the bill", async () => {
    const r = await createScreenSale(db, admin, {
      date: "2026-11-14", walkInName: "Rashid", walkInPhone: "0300-1234567", paidNow: { amount: "300", method: "CASH" },
      items: [{ componentId: id.a, quantity: 1, unit: "packet", unitPrice: "1000", remarks: "cut to size" }],
    });
    id.cash = r.document.id;
    expect([r.document.type, r.document.total, r.document.amountReceived, r.document.walkInName, r.document.walkInPhone])
      .toEqual(["CASH_SALE", "1000", "300", "Rashid", "0300-1234567"]);
    const line = await db.accountingDocumentLine.findFirstOrThrow({ where: { documentId: r.document.id } });
    expect(line.remarks).toBe("cut to size");
    const p = await invoicePayments(db, r.document.id);
    expect([p.atCounter, p.paid, p.remaining, p.status]).toEqual(["300", "300", "700", "PARTIALLY_PAID"]);
    const view = await loadBooksBill(db, r.document.id);
    expect([view?.customerName, view?.customerPhone]).toEqual(["Rashid", "0300-1234567"]);
    expect((await openInvoices(db, r.document.partyAccountId!)).map((o) => o.invoice.id)).toContain(r.document.id);
  });

  it("later cash is a receipt allocated to the bill; the bill itself is not changed; more than owed is refused", async () => {
    const bill = await db.accountingDocument.findUniqueOrThrow({ where: { id: id.cash } });
    const before = JSON.stringify(bill);
    const over = await err(receivePayment(db, admin, { partyAccountId: bill.partyAccountId!, cashAccountId: bill.cashAccountId!, date: "2026-11-15", amount: "701", allocations: [{ invoiceId: bill.id, amount: "701" }] }));
    expect(over?.message).toMatch(/only 700 is still owed/);
    await receivePayment(db, admin, { partyAccountId: bill.partyAccountId!, cashAccountId: bill.cashAccountId!, date: "2026-11-15", amount: "400", allocations: [{ invoiceId: bill.id, amount: "400" }] });
    let p = await invoicePayments(db, bill.id);
    expect([p.paid, p.remaining, p.status, p.payments.length]).toEqual(["700", "300", "PARTIALLY_PAID", 1]);
    await receivePayment(db, admin, { partyAccountId: bill.partyAccountId!, cashAccountId: bill.cashAccountId!, date: "2026-11-16", amount: "300", allocations: [{ invoiceId: bill.id, amount: "300" }] });
    p = await invoicePayments(db, bill.id);
    expect([p.paid, p.remaining, p.status, p.payments.length]).toEqual(["1000", "0", "PAID", 2]);
    expect(JSON.stringify(await db.accountingDocument.findUniqueOrThrow({ where: { id: bill.id } }))).toBe(before);
    expect((await openInvoices(db, bill.partyAccountId!)).map((o) => o.invoice.id)).not.toContain(bill.id);
  });

  it("a fully paid cash sale owes nothing and takes no receipt", async () => {
    const r = await createScreenSale(db, admin, { date: "2026-11-14", walkInName: "Cash buyer", items: [{ componentId: id.a, quantity: 1, unit: "packet", unitPrice: "500" }] });
    const p = await invoicePayments(db, r.document.id);
    expect([p.paid, p.remaining, p.status]).toEqual(["500", "0", "PAID"]);
  });
});

describe("editing a bill keeps added rows and drops removed ones", () => {
  it("rows a+b become b+c: the revision has exactly b and c, stock follows", async () => {
    const stock = async (k: string) => Number((await db.component.findUniqueOrThrow({ where: { id: id[k] } })).quantity);
    const r = await createScreenSale(db, admin, {
      date: "2026-11-14", customerId: id.customer, paidNow: { amount: "0", method: "CASH" },
      items: [{ componentId: id.a, quantity: 2, unit: "packet", unitPrice: "1000" }, { componentId: id.b, quantity: 3, unit: "packet", unitPrice: "1000", remarks: "keep" }],
    });
    const [a0, b0, c0] = [await stock("a"), await stock("b"), await stock("c")];
    const amended = await amendScreenSale(db, admin, r.document.id, {
      date: "2026-11-14", customerId: id.customer,
      items: [{ componentId: id.b, quantity: 3, unit: "packet", unitPrice: "1000", remarks: "keep" }, { componentId: id.c, quantity: 4, unit: "packet", unitPrice: "1000", remarks: "added" }],
    }, "customer changed the order");
    const doc = (amended as { document: { id: string; total: string } }).document;
    const lines = await db.accountingDocumentLine.findMany({ where: { documentId: doc.id }, orderBy: { lineNo: "asc" } });
    expect(lines.map((l) => [l.componentId, l.quantity, l.remarks])).toEqual([[id.b, "3", "keep"], [id.c, "4", "added"]]);
    expect(doc.total).toBe("7000");
    expect([await stock("a") - a0, await stock("b") - b0, await stock("c") - c0]).toEqual([200, 0, -400]);
  });
});

describe("Cash Report (old Cash Sale → Cash Report)", () => {
  it("lists cash sales between dates, those still owing, unpaid between dates and all; received counts counter cash and later receipts", async () => {
    const { cashReport, cashDayBook } = await import("./cash-report");
    const owing = await createScreenSale(db, admin, { date: "2026-11-20", walkInName: "Late payer", paidNow: { amount: "100", method: "CASH" }, items: [{ componentId: id.c, quantity: 1, unit: "packet", unitPrice: "900", remarks: "r1" }] });
    const range = { from: "2026-11-20", to: "2026-11-20" };
    const dates = await cashReport(db, "dates", range);
    expect(dates.rows.map((r) => r.id)).toEqual([owing.document.id]);
    expect([dates.totals.total, dates.totals.paid, dates.totals.remaining]).toEqual([900, 100, 800]);
    const stillOwing = await cashReport(db, "owing");
    expect(stillOwing.rows.map((r) => r.id)).toContain(owing.document.id);
    expect(stillOwing.rows.map((r) => r.id)).not.toContain(id.cash); // settled by Cash Update above
    expect((await cashReport(db, "unpaid", { from: "2026-11-01", to: "2026-11-19" })).rows.map((r) => r.id)).not.toContain(owing.document.id);
    expect((await cashReport(db, "all")).rows.length).toBeGreaterThanOrEqual(3);
    const book = await cashDayBook(db, range);
    expect(book[0].lines).toEqual([{ item: "item c", quantity: "1 packet", price: "900", amount: "900", remarks: "r1" }]);
  });
});
