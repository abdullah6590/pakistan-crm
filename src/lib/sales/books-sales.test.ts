// Sales screens on Books (Report 28 §2-3): customers and payment methods connect to Books accounts, bills post once,
// money paid with the bill is a linked receipt, and edits keep the payments.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "../accounting/test-db";
import { Actor, PostingError, createPurchaseInvoice } from "../accounting/posting";
import { invoicePayments, unappliedReceipts } from "../accounting/receivables";
import { amendScreenSale, createScreenSale, partyForCustomer } from "./books-sales";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let admin: Actor, clerk: Actor, other: Actor;
const id: Record<string, string> = {};

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const mk = async (name: string, role: string) => ({ id: (await db.user.create({ data: { name, email: `${name}@test.local`, password: "x", role: role as never } })).id, role });
  admin = await mk("admin", "ADMIN");
  clerk = await mk("clerk", "EMPLOYEE");
  other = await mk("other", "EMPLOYEE");
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  // An item from the Inventory screen with no Books unit profile: Books derives its units from the item
  id.board = (await db.component.create({ data: { sku: "BB", name: "Box board", categoryId: cat.id, quantity: 0, unitCost: 50, unitPrice: 80 } })).id;
  id.supplier = (await db.ledgerAccount.create({ data: { code: "SUP", name: "Mill", kind: "PARTY", subType: "SUPPLIER" } })).id;
  await createPurchaseInvoice(db, admin, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.board, quantity: 500, unitPrice: 50 }] });
  id.customer = (await db.customer.create({ data: { name: "Ali Traders", phone: "0300" } })).id;
});
afterAll(async () => cleanup());

describe("Sales screens on Books", () => {
  it("a customer from the Customers list gets one linked Books account, created on first use", async () => {
    const a = await db.$transaction((tx) => partyForCustomer(tx, id.customer, admin.id));
    const b = await db.$transaction((tx) => partyForCustomer(tx, id.customer, admin.id));
    expect(a.id).toBe(b.id);
    expect([a.kind, a.subType, a.name, a.code]).toEqual(["PARTY", "CUSTOMER", "Ali Traders", "P-0001"]);
  });

  it("a customer's bill with part paid now: an invoice plus a linked receipt into the method's account", async () => {
    const r = await createScreenSale(db, clerk, { date: "2026-10-05", customerId: id.customer, items: [{ componentId: id.board, quantity: 100, unitPrice: 80 }], paidNow: { amount: "3000", method: "JAZZCASH" } });
    expect(r.document.type).toBe("SALE_INVOICE");
    expect(r.document.total).toBe("8000");
    expect(r.receipt?.docNo).toMatch(/^BRV-/); // JazzCash money goes to a bank-type account
    const p = await invoicePayments(db, r.document.id);
    expect([p.paid, p.remaining, p.status, p.payments[0].method]).toEqual(["3000", "5000", "PARTIALLY_PAID", "JazzCash"]);
    id.bill = r.document.id;
  });

  it("a walk-in bill is a cash sale paid into Cash in hand", async () => {
    const r = await createScreenSale(db, clerk, { date: "2026-10-05", walkInName: "Counter customer", items: [{ componentId: id.board, quantity: 10, unitPrice: 80 }] });
    expect([r.document.type, r.document.total, r.document.amountReceived]).toEqual(["CASH_SALE", "800", "800"]);
    const cash = await db.ledgerAccount.findUniqueOrThrow({ where: { code: "PM-CASH" } });
    expect(r.document.cashAccountId).toBe(cash.id);
  });

  it("a double submit makes one bill", async () => {
    const input = { date: "2026-10-06", customerId: id.customer, items: [{ componentId: id.board, quantity: 1, unitPrice: 80 }], requestId: "44444444-4444-4444-8444-444444444444" };
    const a = await createScreenSale(db, clerk, input);
    const b = await createScreenSale(db, clerk, input);
    expect([b.repeated, b.document.id]).toEqual([true, a.document.id]);
  });

  it("editing a part-paid bill: only its maker or an admin; a lower total frees the excess as credit", async () => {
    const edit = (actor: Actor, qty: number, reason = "Wrong quantity") =>
      amendScreenSale(db, actor, id.bill, { customerId: id.customer, items: [{ componentId: id.board, quantity: qty, unitPrice: 80 }] }, reason);
    const refused = await edit(other, 20).then(() => null, (e) => e);
    expect((refused as PostingError).status).toBe(403);
    const res = await edit(clerk, 25); // 25 x 80 = 2,000 < 3,000 paid
    const p = await invoicePayments(db, res.document.id);
    expect([res.document.docNo.endsWith("/R1"), p.total, p.paid, p.status]).toEqual([true, "2000", "2000", "PAID"]);
    expect(res.releasedCredit.map((c) => c.amount)).toEqual(["1000"]);
    const party = await db.ledgerAccount.findUniqueOrThrow({ where: { customerId: id.customer } });
    expect((await unappliedReceipts(db, party.id)).length).toBe(1);
  });
});
