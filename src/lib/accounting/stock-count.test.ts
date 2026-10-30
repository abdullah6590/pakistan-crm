// Report 28 §6: the item's stock count (Inventory and Sales screens) follows Books' main store by the change, and opening
// stock brings stock already on hand into Books at cost without income.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { toPlain, fromPaisa } from "@/lib/domain/decimal";
import { createTestDb } from "./test-db";
import { Actor, PostingError, amendDocument, approveDocument, cancelDocument, createOpeningStock, createPurchaseInvoice, createSaleInvoice, createStockAdjustment, withoutItemCountChange } from "./posting";
import { setApprovalOverride } from "./setup";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let admin: Actor;
const id: Record<string, string> = {};

const count = async (componentId: string) => (await db.component.findUniqueOrThrow({ where: { id: componentId } })).quantity;
async function glBalance(code: string) {
  const acc = await db.ledgerAccount.findUniqueOrThrow({ where: { code } });
  const agg = await db.journalLine.aggregate({ where: { accountId: acc.id }, _sum: { debitPaisa: true, creditPaisa: true } });
  return toPlain(fromPaisa((agg._sum.debitPaisa ?? BigInt(0)) - (agg._sum.creditPaisa ?? BigInt(0))));
}

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  admin = { id: (await db.user.create({ data: { name: "admin", email: "admin@test.local", password: "x", role: "ADMIN" } })).id, role: "ADMIN" };
  const cat = await db.componentCategory.create({ data: { name: "Board" } });
  id.old = (await db.component.create({ data: { sku: "OLD", name: "Old stock item", categoryId: cat.id, quantity: 50, unitCost: 40 } })).id;
  id.fresh = (await db.component.create({ data: { sku: "NEW", name: "New item", categoryId: cat.id, quantity: 0, unitCost: 10 } })).id;
  id.customer = (await db.ledgerAccount.create({ data: { code: "CUST", name: "Ali", kind: "PARTY", subType: "CUSTOMER" } })).id;
});
afterAll(async () => cleanup());

describe("item counts follow Books", () => {
  it("existing stock enters Books as opening stock at cost: no income, the count is not doubled", async () => {
    const doc = await withoutItemCountChange(() => createOpeningStock(db, admin, { date: "2026-10-01", lines: [{ componentId: id.old, quantity: 50, unitCost: 40 }] })) as { docNo: string; total: string };
    expect([doc.docNo, doc.total]).toEqual(["OS-0001", "2000"]);
    expect(await count(id.old)).toBe(50);
    expect(await glBalance("INVENTORY")).toBe("2000");
    expect(await glBalance("OPENING_BALANCE_EQUITY")).toBe("-2000");
    expect(await glBalance("SALES_REVENUE")).toBe("0");
  });

  it("a new item's opening stock raises its count once", async () => {
    await createOpeningStock(db, admin, { date: "2026-10-01", lines: [{ componentId: id.fresh, quantity: 30, unitCost: 10 }] });
    expect(await count(id.fresh)).toBe(30);
  });

  it("a Books sale lowers the count; an edit and a cancellation put it right", async () => {
    const inv = await createSaleInvoice(db, admin, { date: "2026-10-02", partyAccountId: id.customer, lines: [{ componentId: id.old, quantity: 10, unitPrice: 80 }] });
    expect(await count(id.old)).toBe(40);
    const rev = await amendDocument(db, admin, inv.id, { date: "2026-10-02", partyAccountId: id.customer, lines: [{ componentId: id.old, quantity: 15, unitPrice: 80 }] }, "More taken") as { id: string };
    expect(await count(id.old)).toBe(35);
    await cancelDocument(db, admin, rev.id, "Not delivered");
    expect(await count(id.old)).toBe(50);
  });

  it("stock added outside Books (an older screen) is kept: Books changes the count only by its own movements", async () => {
    await db.component.update({ where: { id: id.old }, data: { quantity: { increment: 5 } } });
    await createSaleInvoice(db, admin, { date: "2026-10-03", partyAccountId: id.customer, lines: [{ componentId: id.old, quantity: 2, unitPrice: 80 }] });
    expect(await count(id.old)).toBe(53);
  });
});

describe("stock counts (owner decision 2026-10-26)", () => {
  it("a count waits for approval; its maker cannot approve it; the owner override needs to be on and a real reason", async () => {
    const store = { id: (await db.user.create({ data: { name: "store", email: "store@test.local", password: "x", role: "INVENTORY_MANAGER" } })).id, role: "INVENTORY_MANAGER" };
    const supplier = (await db.ledgerAccount.create({ data: { code: "SUPP", name: "Mill", kind: "PARTY", subType: "SUPPLIER" } })).id;
    await createPurchaseInvoice(db, admin, { date: "2026-10-04", partyAccountId: supplier, lines: [{ componentId: id.fresh, quantity: 20, unitPrice: 12 }] });
    const before = await count(id.fresh); // 30 + 20 = 50
    expect(before).toBe(50);

    const byStore = await createStockAdjustment(db, store, { date: "2026-10-05", lines: [{ componentId: id.fresh, quantity: 47 }], remarks: "Counted by store" }) as { id: string; status: string };
    expect(byStore.status).toBe("PENDING_APPROVAL");
    expect(await count(id.fresh)).toBe(50); // nothing moves until approved
    const own = await approveDocument(db, store, byStore.id).then(() => null, (e) => e);
    expect(own).toBeInstanceOf(PostingError);

    await approveDocument(db, admin, byStore.id);
    expect(await count(id.fresh)).toBe(47);
    const line = await db.accountingDocumentLine.findFirstOrThrow({ where: { documentId: byStore.id } });
    expect([line.bookQuantity, line.baseQuantity]).toEqual(["50", "47"]);
    expect(line.costAmount).toBe("32.4"); // 3 short, valued at the average cost of 10.8 ((30 x 10 + 20 x 12) / 50)
    const history = await db.inventoryHistory.findFirstOrThrow({ where: { componentId: id.fresh, type: "ADJUST" } });
    expect(history.reference).toMatch(/stock count \(was 50, counted 47\)/);
    const applied = await db.auditLog.findFirstOrThrow({ where: { entityId: byStore.id, action: "COUNT_APPLIED" } });
    expect(JSON.parse(applied.after!)[0]).toMatchObject({ screenBefore: 50, booksBefore: "50", counted: "47", adjustment: "-3" });

    // The owner's own count: refused until the override is on, then only with a reason of 10+ characters
    const mine = await createStockAdjustment(db, admin, { date: "2026-10-06", lines: [{ componentId: id.fresh, quantity: 48 }], remarks: "Recount by owner" }) as { id: string };
    expect(await approveDocument(db, admin, mine.id).then(() => null, (e) => (e as Error).message)).toMatch(/override|prepared/i);
    await setApprovalOverride(db, { userId: admin.id, changedBy: "test", reason: "Only administrator of this business" });
    expect(await approveDocument(db, admin, mine.id, { overrideReason: "short" }).then(() => null, (e) => (e as Error).message)).toMatch(/at least 10 characters/);
    await approveDocument(db, admin, mine.id, { overrideReason: "Found one packet behind the rack" });
    expect(await count(id.fresh)).toBe(48);
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: mine.id, action: "APPROVE_SELF_OVERRIDE" } })).reason).toBe("Found one packet behind the rack");
  });

  it("an item whose stock never entered Books is set to the count, not the count added on top", async () => {
    const cat = await db.componentCategory.findFirstOrThrow();
    const outside = (await db.component.create({ data: { sku: "OUT", name: "Outside item", categoryId: cat.id, quantity: 75 } })).id;
    const c = await createStockAdjustment(db, admin, { date: "2026-10-07", lines: [{ componentId: outside, quantity: 70 }], remarks: "First count" }) as { id: string };
    await approveDocument(db, admin, c.id, { overrideReason: "Only administrator, first count" });
    expect(await count(outside)).toBe(70);
    const main = await db.stockLocation.findUniqueOrThrow({ where: { code: "MAIN" } });
    expect((await db.itemStockBalance.findUniqueOrThrow({ where: { componentId_locationId: { componentId: outside, locationId: main.id } } })).onHand).toBe("70");
  });
});
