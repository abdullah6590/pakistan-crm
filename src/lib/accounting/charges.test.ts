// Owner rules of 2026-10-22: recording a freight, loading, bilty or printing charge never posts anything;
// "Post as expense" posts it exactly once. Also: separation of duties for stock-issue approval.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { toPlain, fromPaisa, dec } from "@/lib/domain/decimal";
import { createTestDb } from "./test-db";
import { setSetting, setApprovalOverride } from "./setup";
import {
  Actor, PostingError, accountBalance, cancelDocument, createPurchaseInvoice, createPressDispatch, createPressReceipt, createStockIssue, approveDocument,
} from "./posting";
import { recordCharge, postChargeAsExpense, reverseChargePosting, editCharge, cancelCharge } from "./charges";
import { trialBalance, selfApprovalReport } from "./queries";

let db: PrismaClient;
let cleanup: () => Promise<void>;
const id: Record<string, string> = {};
let admin: Actor, owner: Actor, accountant: Actor, storeman: Actor;

const bal = async (accountId: string) => toPlain(await accountBalance(db, accountId));
const code = async (c: string) => (await db.ledgerAccount.findUniqueOrThrow({ where: { code: c } })).id;
const journalOf = async (documentId: string) =>
  (await db.journalLine.findMany({ where: { entry: { documentId } }, include: { account: true, entry: true } }))
    .map((l) => ({ kind: l.entry.kind, code: l.account.code, dr: toPlain(fromPaisa(l.debitPaisa)), cr: toPlain(fromPaisa(l.creditPaisa)) }));
async function expectError(p: Promise<unknown>, status: number, message?: RegExp) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PostingError);
  expect((err as PostingError).status).toBe(status);
  if (message) expect((err as Error).message).toMatch(message);
}
/** Every balance and stock figure the rules say must not move when a charge is only recorded. */
async function snapshot() {
  const journals = await db.journalLine.count();
  const accounts = await db.ledgerAccount.findMany();
  const balances: Record<string, string> = {};
  for (const a of accounts) balances[a.code] = await bal(a.id);
  const costs = await db.itemCostState.findMany({ orderBy: { componentId: "asc" } });
  const movements = await db.stockMovement.count();
  return { journals, balances, costs: costs.map((c) => [c.componentId, c.onHand, c.averageCost]), movements };
}

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  const mkUser = async (name: string, role: string) => (await db.user.create({ data: { name, email: `${name}@test.local`, password: "x", role: role as never } })).id;
  admin = { id: await mkUser("admin", "ADMIN"), role: "ADMIN" };
  owner = { id: await mkUser("owner", "ADMIN"), role: "ADMIN" };
  accountant = { id: await mkUser("accountant", "ACCOUNTANT"), role: "ACCOUNTANT" };
  storeman = { id: await mkUser("storeman", "INVENTORY_MANAGER"), role: "INVENTORY_MANAGER" };
  const cat = await db.componentCategory.create({ data: { name: "Test" } });
  for (const key of ["paper", "printed"]) {
    const c = await db.component.create({ data: { sku: key, name: key, categoryId: cat.id } });
    await db.itemUnitProfile.create({ data: { componentId: c.id, kind: "PIECE", baseUnit: "piece", confirmed: true } });
    id[key] = c.id;
  }
  for (const [key, kind, subType] of [["supplier", "PARTY", "SUPPLIER"], ["transporter", "PARTY", "OTHER"], ["press", "PARTY", "PRESS"], ["cash", "CASH_BANK", "CASH"], ["bank", "CASH_BANK", "BANK"]]) {
    id[key] = (await db.ledgerAccount.create({ data: { code: key.toUpperCase(), name: key, kind, subType } })).id;
  }
  const pi = await createPurchaseInvoice(db, admin, { date: "2026-10-01", partyAccountId: id.supplier, lines: [{ componentId: id.paper, quantity: 1000, unitPrice: 10 }] });
  id.purchase = pi.id;
});

afterAll(async () => {
  await cleanup?.();
});

describe("purchase and printing charges (owner rules 2026-10-22)", () => {
  it("1. recording freight, loading or bilty alone changes no stock, cost, supplier, expense, cash or bank figure", async () => {
    const before = await snapshot();
    const withPurchase = await createPurchaseInvoice(db, admin, {
      date: "2026-10-02", partyAccountId: id.supplier, lines: [{ componentId: id.paper, quantity: 100, unitPrice: 10 }],
      charges: [{ kind: "FREIGHT", amount: 1500, description: "Truck Lahore to shop", reference: "Bilty 4471" }, { kind: "LOADING", amount: 300, description: "Labour" }],
    });
    const standalone = await recordCharge(db, storeman, { kind: "BILTY", date: "2026-10-02", amount: "120.50", description: "Bilty fee", documentId: id.purchase, partyAccountId: id.transporter });
    const after = await snapshot();
    // The purchase itself moves stock and the supplier by exactly its line value (1000), nothing for the charges
    expect(withPurchase.total).toBe("1000");
    expect(Number(after.balances.SUPPLIER) - Number(before.balances.SUPPLIER)).toBe(-1000);
    expect(Number(after.balances.INVENTORY) - Number(before.balances.INVENTORY)).toBe(1000);
    for (const c of ["FREIGHT_EXPENSE", "LOADING_EXPENSE", "BILTY_EXPENSE", "CASH", "BANK", "TRANSPORTER"]) expect(after.balances[c]).toBe(before.balances[c]);
    expect((await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.paper } })).averageCost).toBe("10"); // charges not capitalised
    const charges = await db.chargeRecord.findMany({ orderBy: { number: "asc" } });
    expect(charges.map((c) => [c.chargeNo, c.kind, c.amount, c.status, c.postedDocumentId])).toEqual([
      ["CHG-0001", "FREIGHT", "1500", "RECORDED", null],
      ["CHG-0002", "LOADING", "300", "RECORDED", null],
      ["CHG-0003", "BILTY", "120.5", "RECORDED", null],
    ]);
    expect(charges[0].documentId).toBe(withPurchase.id);
    expect(standalone.partyAccountId).toBe(id.transporter);
    await expectError(recordCharge(db, storeman, { kind: "PRINTING", date: "2026-10-02", amount: 1, description: "x", documentId: id.purchase }), 400, /must refer to/);
  });

  it("2. posting explicitly records the expense exactly once, even with repeated or simultaneous requests", async () => {
    const freight = await db.chargeRecord.findFirstOrThrow({ where: { kind: "FREIGHT" } });
    await expectError(postChargeAsExpense(db, storeman, freight.id, { settlement: "PAID", cashAccountId: id.cash }), 403);
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => postChargeAsExpense(db, accountant, freight.id, { settlement: "PAID", cashAccountId: id.cash })));
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const refused = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(refused.every((r) => r.reason instanceof PostingError && r.reason.status === 409)).toBe(true);
    await expectError(postChargeAsExpense(db, accountant, freight.id, { settlement: "PAID", cashAccountId: id.cash }), 409, /already posted/);
    expect(await db.accountingDocument.count({ where: { type: "CHARGE_EXPENSE", chargeId: freight.id } })).toBe(1);
    expect(await bal(await code("FREIGHT_EXPENSE"))).toBe("1500");
  });

  it("3. paid now credits cash/bank; payable credits the payee and leaves cash untouched", async () => {
    const freight = await db.chargeRecord.findFirstOrThrow({ where: { kind: "FREIGHT" } });
    expect(await journalOf(freight.postedDocumentId!)).toEqual(expect.arrayContaining([
      { kind: "POSTING", code: "FREIGHT_EXPENSE", dr: "1500", cr: "0" },
      { kind: "POSTING", code: "CASH", dr: "0", cr: "1500" },
    ]));
    const loading = await db.chargeRecord.findFirstOrThrow({ where: { kind: "LOADING" } });
    const cashBefore = await bal(id.cash);
    await expectError(postChargeAsExpense(db, accountant, loading.id, { settlement: "PAID" }), 400, /cash or bank/);
    const posted = await postChargeAsExpense(db, accountant, loading.id, { settlement: "PAYABLE", payeeAccountId: id.transporter });
    expect(await journalOf(posted.document.id)).toEqual(expect.arrayContaining([
      { kind: "POSTING", code: "LOADING_EXPENSE", dr: "300", cr: "0" },
      { kind: "POSTING", code: "TRANSPORTER", dr: "0", cr: "300" },
    ]));
    expect([posted.document.previousBalance, posted.document.newBalance]).toEqual(["0", "-300"]);
    expect(await bal(id.cash)).toBe(cashBefore);
    const bilty = await db.chargeRecord.findFirstOrThrow({ where: { kind: "BILTY" } });
    await expectError(postChargeAsExpense(db, accountant, bilty.id, { settlement: "PAYABLE", expenseAccountId: id.supplier }), 400, /expense account/);
  });

  it("4. recording a printing charge alone changes neither production cost nor any balance", async () => {
    await createPressDispatch(db, storeman, { date: "2026-10-03", pressAccountId: id.press, lines: [{ componentId: id.paper, quantity: 300 }] });
    const before = await snapshot();
    const pr = await createPressReceipt(db, storeman, {
      date: "2026-10-04", pressAccountId: id.press,
      lines: [{ componentId: id.printed, quantity: 1000, consumedComponentId: id.paper, consumedQuantity: 250 }],
      charges: [{ kind: "PRINTING", amount: 4000, description: "Printing 1000 boxes, 2 colours", reference: "Job 88" }],
    });
    id.pressReceipt = pr.id;
    const after = await snapshot();
    expect(pr.lines[0].costAmount).toBe("2500"); // 250 x 10 material only
    expect(after.journals).toBe(before.journals);
    expect(after.balances).toEqual(before.balances);
    expect((await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.printed } })).averageCost).toBe("2.5");
    const charge = await db.chargeRecord.findFirstOrThrow({ where: { documentId: pr.id } });
    expect([charge.kind, charge.status, charge.partyAccountId, charge.reference]).toEqual(["PRINTING", "RECORDED", id.press, "Job 88"]);
    id.printingCharge = charge.id;
  });

  it("5. posting a printing charge creates the expense and the payment or the liability to the press", async () => {
    const payable = await postChargeAsExpense(db, accountant, id.printingCharge, { settlement: "PAYABLE" }); // payee defaults to the press
    expect(await journalOf(payable.document.id)).toEqual(expect.arrayContaining([
      { kind: "POSTING", code: "PRINTING_EXPENSE", dr: "4000", cr: "0" },
      { kind: "POSTING", code: "PRESS", dr: "0", cr: "4000" },
    ]));
    expect(await bal(id.press)).toBe("-4000");
    const paid = await recordCharge(db, accountant, { kind: "PRINTING", date: "2026-10-05", amount: 500, description: "Plate making", partyAccountId: id.press, documentId: id.pressReceipt });
    const bankBefore = await bal(id.bank);
    const p2 = await postChargeAsExpense(db, accountant, paid.id, { settlement: "PAID", cashAccountId: id.bank });
    expect(await journalOf(p2.document.id)).toEqual(expect.arrayContaining([{ kind: "POSTING", code: "BANK", dr: "0", cr: "500" }]));
    expect(Number(await bal(id.bank)) - Number(bankBefore)).toBe(-500);
    expect(await bal(id.press)).toBe("-4000"); // paid immediately: nothing owed to the press
  });

  it("6. editing, reversing or cancelling a posted charge keeps the books balanced and the history", async () => {
    const freight = await db.chargeRecord.findFirstOrThrow({ where: { kind: "FREIGHT" } });
    const firstDoc = freight.postedDocumentId!;
    await expectError(cancelDocument(db, admin, firstDoc, "trying to bypass"), 409, /charge record/);
    await expectError(editCharge(db, accountant, freight.id, { amount: 1600 }, "Corrected bill"), 403); // reversing a posting is ADMIN only
    const edited = await editCharge(db, admin, freight.id, { amount: 1600 }, "Corrected bill");
    expect([edited.charge.status, edited.charge.amount, edited.charge.postedDocumentId, edited.reversedDocumentId]).toEqual(["RECORDED", "1600", null, firstDoc]);
    expect((await db.accountingDocument.findUniqueOrThrow({ where: { id: firstDoc } })).status).toBe("CANCELLED");
    expect(await bal(await code("FREIGHT_EXPENSE"))).toBe("0");
    const reposted = await postChargeAsExpense(db, accountant, freight.id, { settlement: "PAID", cashAccountId: id.cash });
    expect(reposted.document.id).not.toBe(firstDoc);
    expect(await bal(await code("FREIGHT_EXPENSE"))).toBe("1600");
    expect(await db.accountingDocument.count({ where: { chargeId: freight.id } })).toBe(2); // both versions kept

    const loading = await db.chargeRecord.findFirstOrThrow({ where: { kind: "LOADING" } });
    await reverseChargePosting(db, admin, loading.id, "Transporter waived it");
    expect(await bal(id.transporter)).toBe("0");
    const cancelled = await cancelCharge(db, admin, freight.id, "Duplicate of supplier bill");
    expect(cancelled.charge.status).toBe("CANCELLED");
    expect(await bal(await code("FREIGHT_EXPENSE"))).toBe("0");
    await expectError(postChargeAsExpense(db, accountant, freight.id, { settlement: "PAID", cashAccountId: id.cash }), 409, /cancelled/);
    await expectError(editCharge(db, admin, freight.id, { amount: 1 }, "x"), 409);

    const history = (await db.auditLog.findMany({ where: { entity: "ChargeRecord", entityId: freight.id }, orderBy: { createdAt: "asc" } })).map((h) => h.action);
    expect(history).toEqual(["CREATE", "POST", "UNPOST_FOR_EDIT", "EDIT", "POST", "UNPOST_FOR_CANCEL", "CANCEL"]);
    expect((await trialBalance(db)).balanced).toBe(true);
    // History tables are append-only at the database level (A-01)
    await expect(db.$executeRawUnsafe(`DELETE FROM "journal_lines"`)).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`UPDATE "audit_logs" SET "action" = 'X'`)).rejects.toThrow(/append-only/);
  });

  it("7. material consumed at the press stays separate from optional printing-charge expenses", async () => {
    const receiptLine = await db.accountingDocumentLine.findFirstOrThrow({ where: { documentId: id.pressReceipt } });
    expect(receiptLine.costAmount).toBe("2500");
    expect((await db.itemCostState.findUniqueOrThrow({ where: { componentId: id.printed } })).averageCost).toBe("2.5");
    // Expense postings never touch stock: no stock movement belongs to any CHARGE_EXPENSE document
    expect(await db.stockMovement.count({ where: { document: { type: "CHARGE_EXPENSE" } } })).toBe(0);
    // Inventory account = value of stock movements: posted printing charges are not in it
    const moved = (await db.stockMovement.findMany({ where: { kind: { not: "RELOCATE" }, costAmount: { not: null } } }))
      .filter((m) => !m.kind.startsWith("RELOCATE")).reduce((a, m) => a + dec(m.costAmount!), dec(0));
    expect(toPlain(moved)).toBe(await bal(await code("INVENTORY")));
  });
});

describe("stock-issue approval: separation of duties", () => {
  it("nobody approves their own issue; a nominated owner may, with a written reason, and it is audited separately", async () => {
    const own = await createStockIssue(db, admin, { date: "2026-10-06", reason: "SAMPLE", remarks: "Sample for customer", lines: [{ componentId: id.paper, quantity: 5 }] });
    await expectError(approveDocument(db, admin, own.id), 403, /separation of duties/);
    await expect(setSetting(db, "SELF_APPROVAL_OVERRIDE_USER", admin.id, admin.id)).rejects.toThrow(/Another administrator/);
    await expect(setSetting(db, "SELF_APPROVAL_OVERRIDE_USER", accountant.id, admin.id)).rejects.toThrow(/active administrator/);
    const posted = await approveDocument(db, owner, own.id); // a different administrator: normal approval
    expect([posted.status, posted.approvedById]).toEqual(["POSTED", owner.id]);

    const ownersOwn = await createStockIssue(db, owner, { date: "2026-10-06", reason: "SAMPLE", remarks: "Owner sample", lines: [{ componentId: id.paper, quantity: 1 }] });
    await expectError(approveDocument(db, owner, ownersOwn.id), 403);
    await setSetting(db, "SELF_APPROVAL_OVERRIDE_USER", owner.id, admin.id); // nominated by another administrator
    await expectError(approveDocument(db, owner, ownersOwn.id, { overrideReason: "ok" }), 400, /override reason/);
    const self = await approveDocument(db, owner, ownersOwn.id, { overrideReason: "Only administrator on site today" });
    expect(self.status).toBe("POSTED");
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: ownersOwn.id, action: "APPROVE_SELF_OVERRIDE" } });
    expect([audit.userId, audit.reason]).toEqual([owner.id, "Only administrator on site today"]);
    const adminsOwn = await createStockIssue(db, admin, { date: "2026-10-06", reason: "SAMPLE", remarks: "x", lines: [{ componentId: id.paper, quantity: 1 }] });
    await expectError(approveDocument(db, admin, adminsOwn.id, { overrideReason: "I would like to approve this" }), 403); // only the nominated owner
  });

  it("D-2: the override is switched on separately at the server, only for an administrator of this business, and fully reported", async () => {
    await expect(setApprovalOverride(db, { userId: admin.id, changedBy: "operator:test", reason: "short" })).rejects.toThrow(/at least 10/);
    await expect(setApprovalOverride(db, { userId: accountant.id, changedBy: "operator:test", reason: "Accountant is not an admin" })).rejects.toThrow(/active administrator of this business/);
    await expect(setApprovalOverride(db, { userId: "user-of-another-business", changedBy: "operator:test", reason: "Not a user of this business" })).rejects.toThrow(/of this business/);
    await setApprovalOverride(db, { userId: null, changedBy: "operator:test", reason: "Off until the owner asks" });
    const count = await createStockIssue(db, owner, { date: "2026-10-07", reason: "SAMPLE", remarks: "Owner's own", lines: [{ componentId: id.paper, quantity: 1 }] });
    await expectError(approveDocument(db, owner, count.id, { overrideReason: "No other administrator today" }), 403); // off: refused
    // The owner (single administrator) can be enabled for themselves, but only by this separate step
    await setApprovalOverride(db, { userId: owner.id, changedBy: "operator:test", reason: "Owner works alone on Fridays" });
    await approveDocument(db, owner, count.id, { overrideReason: "No other administrator today" });
    const r = await selfApprovalReport(db);
    expect(r.approvals.map((a) => [a.docNo, a.reason])).toEqual(expect.arrayContaining([[expect.any(String), "No other administrator today"], [expect.any(String), "Only administrator on site today"]]));
    expect(r.settingChanges.slice(-2).map((c) => [c.changedBy, c.reason])).toEqual([["operator:test", "Off until the owner asks"], ["operator:test", "Owner works alone on Fridays"]]);
    await setApprovalOverride(db, { userId: null, changedBy: "operator:test", reason: "Second administrator hired" });
  });
});
