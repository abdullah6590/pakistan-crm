// Sale bills (Sales module): editing a saved bill corrects stock, the customer's balance and Finance exactly as if
// the corrected bill had been made in the first place, keeps the invoice number, and is audited.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "../accounting/test-db";
import { createSale, editSale, SaleError } from "./bill";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};
const admin = { id: "", role: "ADMIN" };
const clerk = { id: "", role: "EMPLOYEE" };
const other = { id: "", role: "EMPLOYEE" };

const stock = async (componentId: string) => (await db.component.findUniqueOrThrow({ where: { id: componentId } })).quantity;
const customer = async (customerId: string) => db.customer.findUniqueOrThrow({ where: { id: customerId } });
const income = async (saleId: string) => db.finance.findMany({ where: { referenceId: saleId, type: "INCOME", category: "SALES" } });
const charges = async (customerId: string) => db.customerPayment.findMany({ where: { customerId } });
const make = (user: { id: string }, input: Parameters<typeof createSale>[2], no: string) => db.$transaction((tx) => createSale(tx, user.id, input, no));

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  for (const [u, name, role] of [[admin, "admin", "ADMIN"], [clerk, "clerk", "EMPLOYEE"], [other, "other", "EMPLOYEE"]] as const) {
    u.id = (await db.user.create({ data: { name, email: `${name}@test.local`, password: "x", role: role as never } })).id;
  }
  const cat = await db.componentCategory.create({ data: { name: "Cups" } });
  for (const [key, qty, cost] of [["cup", 15, 400], ["lid", 50, 20]] as const) {
    id[key] = (await db.component.create({ data: { sku: key, name: key, categoryId: cat.id, quantity: qty, unitCost: cost, unitPrice: cost * 2 } })).id;
  }
  id.ali = (await db.customer.create({ data: { name: "Ali Traders" } })).id;
  id.bilal = (await db.customer.create({ data: { name: "Bilal Store" } })).id;
});
afterAll(async () => cleanup());

describe("editing a saved sale bill", () => {
  it("a paid walk-in bill: correcting the quantity and price moves stock and Finance to the corrected amounts", async () => {
    const sale = await make(clerk, { walkInName: "Counter", paymentMethod: "CASH", paymentStatus: "PAID", items: [{ componentId: id.cup, quantity: 1, unitPrice: 660 }] }, "INV-T1");
    expect(await stock(id.cup)).toBe(14);
    expect((await income(sale.id)).map((f) => f.amount)).toEqual([660]);

    const edited = await editSale(db, clerk, sale.id, { walkInName: "Counter", paymentMethod: "CASH", paymentStatus: "PAID", items: [{ componentId: id.cup, quantity: 3, unitPrice: 700 }] }, "Customer took 3");
    expect(edited.invoiceNumber).toBe("INV-T1");
    expect(edited.total).toBe(2100);
    expect(edited.profit).toBe((700 - 400) * 3);
    expect(await stock(id.cup)).toBe(12); // 15 - 3, not 15 - 1 - 3
    expect((await income(sale.id)).map((f) => f.amount)).toEqual([2100]); // one income entry, corrected
    const history = await db.inventoryHistory.findMany({ where: { componentId: id.cup }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => `${h.type} ${h.quantity} -> ${h.balanceAfter}`)).toEqual(["REMOVE 1 -> 14", "ADD 1 -> 15", "REMOVE 3 -> 12"]);
  });

  it("a credit bill: the customer's balance and charge follow the corrected total; lines can be added and removed", async () => {
    const sale = await make(clerk, { customerId: id.ali, paymentStatus: "PENDING", paymentMethod: "CASH", items: [{ componentId: id.cup, quantity: 2, unitPrice: 800 }] }, "INV-T2");
    expect((await customer(id.ali)).balanceDue).toBe(1600);

    await editSale(db, admin, sale.id, { customerId: id.ali, paymentStatus: "PENDING", paymentMethod: "CASH", discount: 100, items: [{ componentId: id.lid, quantity: 10, unitPrice: 40 }, { componentId: id.cup, quantity: 1, unitPrice: 800 }] });
    const ali = await customer(id.ali);
    expect(ali.balanceDue).toBe(1100); // 400 + 800 - 100
    expect(ali.visitCount).toBe(1);
    expect((await charges(id.ali)).map((c) => [c.amount, c.saleId])).toEqual([[1100, sale.id]]);
    expect(await income(sale.id)).toEqual([]);
    expect(await stock(id.cup)).toBe(11);
    expect(await stock(id.lid)).toBe(40);
  });

  it("moving a bill to another customer and marking it paid takes the charge off the first customer", async () => {
    const sale = await make(clerk, { customerId: id.bilal, paymentStatus: "PENDING", paymentMethod: "CASH", items: [{ componentId: id.lid, quantity: 5, unitPrice: 40 }] }, "INV-T3");
    expect((await customer(id.bilal)).balanceDue).toBe(200);

    await editSale(db, admin, sale.id, { customerId: id.ali, paymentStatus: "PAID", paymentMethod: "BANK_TRANSFER", items: [{ componentId: id.lid, quantity: 5, unitPrice: 40 }] });
    const bilal = await customer(id.bilal);
    expect([bilal.balanceDue, bilal.visitCount]).toEqual([0, 0]);
    expect(await charges(id.bilal)).toEqual([]);
    const ali = await customer(id.ali);
    expect([ali.balanceDue, ali.visitCount]).toEqual([1100, 2]); // unchanged balance (paid), one more visit
    expect((await income(sale.id)).map((f) => [f.amount, f.paymentMethod])).toEqual([[200, "BANK_TRANSFER"]]);
  });

  it("an edit that needs more stock than exists changes nothing", async () => {
    const sale = await make(clerk, { walkInName: "Counter", paymentStatus: "PAID", items: [{ componentId: id.cup, quantity: 1, unitPrice: 700 }] }, "INV-T4");
    const before = { cup: await stock(id.cup), income: await income(sale.id) };
    await expect(editSale(db, clerk, sale.id, { walkInName: "Counter", paymentStatus: "PAID", items: [{ componentId: id.cup, quantity: 999, unitPrice: 700 }] })).rejects.toThrow(/Insufficient stock/);
    expect(await stock(id.cup)).toBe(before.cup);
    expect(await income(sale.id)).toEqual(before.income);
    expect((await db.saleItem.findMany({ where: { saleId: sale.id } })).map((i) => i.quantity)).toEqual([1]);
  });

  it("only an administrator or the bill's maker may edit it, and every edit is in the audit log", async () => {
    const sale = await make(clerk, { walkInName: "Counter", paymentStatus: "PAID", items: [{ componentId: id.lid, quantity: 1, unitPrice: 40 }] }, "INV-T5");
    const err = await editSale(db, other, sale.id, { walkInName: "Counter", items: [{ componentId: id.lid, quantity: 2, unitPrice: 40 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(SaleError);
    expect((err as SaleError).status).toBe(403);
    await expect(editSale(db, clerk, sale.id, { items: [{ componentId: id.lid, quantity: 2, unitPrice: 40 }] })).rejects.toThrow(/customer/);

    const log = await db.auditLog.findMany({ where: { entity: "Sale", entityId: (await db.sale.findUniqueOrThrow({ where: { invoiceNumber: "INV-T1" } })).id } });
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("AMEND");
    expect(log[0].reason).toBe("Customer took 3");
    expect(JSON.parse(log[0].before!).total).toBe(660);
    expect(JSON.parse(log[0].after!).total).toBe(2100);
  });
});
