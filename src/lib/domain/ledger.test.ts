import { describe, expect, it } from "vitest";
import { dec, toFixed } from "./decimal";
import {
  GL, AccountRef, accountMovement, totals, balancePresentation,
  postSaleInvoice, postCashSale, postPurchaseInvoice, postStockIssue, postReceipt, postPayment,
  postVoucher, postOpeningBalance, postTransfer,
} from "./ledger";

const party: AccountRef = { type: "PARTY", id: "P1" };
const bank: AccountRef = { type: "CASH_BANK", id: "BANK" };
const cash: AccountRef = { type: "CASH_BANK", id: "CASH" };
const dailyExpenses: AccountRef = { type: "GL", id: "DAILY_EXPENSES" };
const pressMaterial: AccountRef = { type: "GL", id: "STOCK_ISSUE_PRESS_MATERIAL" };
const f = (a: bigint) => toFixed(a, 2);

describe("double-entry postings (OD-10) reproducing legacy party/bank effects", () => {
  it("[OD-01] sale invoice: party Dr the printed rounded total; revenue exact; rounding explicit; balanced", () => {
    const { entry, total } = postSaleInvoice({
      party,
      lines: [
        { amount: dec("2787.096774"), cost: dec("2600"), costStatus: "ACTUAL" },
        { amount: dec("2690.167742"), cost: dec("2500"), costStatus: "ACTUAL" },
      ],
    });
    expect(f(total.total)).toBe("5477.00");
    expect(f(accountMovement(entry, party))).toBe("5477.00");
    expect(f(accountMovement(entry, GL.SALES_REVENUE))).toBe("-5477.26");
    expect(f(accountMovement(entry, GL.ROUNDING))).toBe("0.26");
    expect(f(accountMovement(entry, GL.COST_OF_GOODS_SOLD))).toBe("5100.00");
    expect(f(accountMovement(entry, GL.INVENTORY))).toBe("-5100.00");
    const t = totals(entry);
    expect(t.debit).toBe(t.credit);
  });

  it("[OD-03] reports lines whose cost is estimated or unavailable instead of hiding them", () => {
    const { entry } = postSaleInvoice({
      party,
      lines: [
        { amount: dec(100), cost: dec(80), costStatus: "ACTUAL" },
        { amount: dec(50), cost: dec(30), costStatus: "ESTIMATED" },
        { amount: dec(20), cost: null, costStatus: "UNAVAILABLE" },
      ],
    });
    expect(entry.costFlags).toEqual([{ line: 2, status: "ESTIMATED" }, { line: 3, status: "UNAVAILABLE" }]);
    expect(f(accountMovement(entry, GL.COST_OF_GOODS_SOLD))).toBe("110.00");
  });

  it("[LEGACY TQ-10] receipt: party Cr, bank Dr; payment: party Dr, bank Cr (TC-DEC-09)", () => {
    const r = postReceipt({ party, into: bank, amount: dec(12000) });
    expect(f(accountMovement(r, party))).toBe("-12000.00");
    expect(f(accountMovement(r, bank))).toBe("12000.00");
    const p = postPayment({ party, from: bank, amount: dec(5000) });
    expect(f(accountMovement(p, party))).toBe("5000.00");
    expect(f(accountMovement(p, bank))).toBe("-5000.00");
  });

  it("[LEGACY TQ-10] payment voucher: debit account Dr, bank Cr", () => {
    const v = postVoucher({ documentType: "PAYMENT_VOUCHER", debit: dailyExpenses, credit: bank, amount: dec(3870) });
    expect(f(accountMovement(v, dailyExpenses))).toBe("3870.00");
    expect(f(accountMovement(v, bank))).toBe("-3870.00");
  });

  it("purchase: inventory Dr, party Cr (paisa precision by default)", () => {
    const { entry, total } = postPurchaseInvoice({ party, lineAmounts: [dec("92848"), dec("153.6")] });
    expect(f(total.total)).toBe("93001.60");
    expect(f(accountMovement(entry, party))).toBe("-93001.60");
    expect(f(accountMovement(entry, GL.INVENTORY))).toBe("93001.60");
  });

  it("[OD-05] cash sale: received into bank, revenue, no party balance when fully paid (TC-DEC-05 i)", () => {
    const { entry } = postCashSale({
      receivedInto: bank, amountReceived: dec(5000),
      lines: [{ amount: dec(5000), cost: null, costStatus: "UNAVAILABLE" }],
    });
    expect(f(accountMovement(entry, bank))).toBe("5000.00");
    expect(f(accountMovement(entry, GL.SALES_REVENUE))).toBe("-5000.00");
    expect(() => postCashSale({ receivedInto: bank, amountReceived: dec(100), lines: [{ amount: dec(200), cost: null, costStatus: "UNAVAILABLE" }] }))
      .toThrow(/must name the party/);
    const partly = postCashSale({ receivedInto: cash, amountReceived: dec(100), party, lines: [{ amount: dec(200), cost: null, costStatus: "UNAVAILABLE" }] });
    expect(f(accountMovement(partly.entry, party))).toBe("100.00");
  });

  it("[OD-05] stock issue: no revenue; cost moves to the issue account; zero cost posts nothing (TC-DEC-05 ii)", () => {
    const e = postStockIssue({ issueAccount: pressMaterial, lines: [{ amount: dec(0), cost: dec("6789.37"), costStatus: "ACTUAL" }] });
    expect(f(accountMovement(e, pressMaterial))).toBe("6789.37");
    expect(f(accountMovement(e, GL.INVENTORY))).toBe("-6789.37");
    expect(f(accountMovement(e, GL.SALES_REVENUE))).toBe("0.00");
    const zero = postStockIssue({ issueAccount: pressMaterial, lines: [{ amount: dec(0), cost: null, costStatus: "UNAVAILABLE" }] });
    expect(zero.lines).toHaveLength(0);
    expect(zero.costFlags).toEqual([{ line: 1, status: "UNAVAILABLE" }]);
  });

  it("opening balance and transfer are balanced", () => {
    const o = postOpeningBalance({ account: party, debit: dec(0), credit: dec(34866) });
    expect(f(accountMovement(o, party))).toBe("-34866.00");
    const t = postTransfer({ from: bank, to: cash, amount: dec(1000) });
    expect(f(accountMovement(t, cash))).toBe("1000.00");
    expect(() => postTransfer({ from: bank, to: cash, amount: dec(0) })).toThrow();
  });

  it("[OD-09] previous balance, this invoice and new balance (TC-DEC-07)", () => {
    const { entry } = postSaleInvoice({ party, lines: [{ amount: dec(5000), cost: null, costStatus: "UNAVAILABLE" }] });
    const p = balancePresentation(dec("10000.37"), entry, party);
    expect(f(p.previousBalance)).toBe("10000.37");
    expect(f(p.thisDocument)).toBe("5000.00");
    expect(f(p.newBalance)).toBe("15000.37");
  });
});
