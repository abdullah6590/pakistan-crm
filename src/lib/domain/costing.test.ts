import { describe, expect, it } from "vitest";
import { dec, toFixed } from "./decimal";
import { receive, issue, EMPTY_COST_STATE, legacyPaperUnitCost, legacyLineCost, referenceCostPerPack } from "./costing";
import { weightPer100Sheets, weightPerPacket } from "./pricing";

describe("costing (OD-03, weighted average)", () => {
  it("averages purchase costs and issues at the average (ACTUAL)", () => {
    let s = receive(EMPTY_COST_STATE, dec(1000), dec(20));
    s = receive(s, dec(1000), dec(24));
    expect(toFixed(s.averageCost!, 2)).toBe("22.00");
    const r = issue(s, dec(500));
    expect(r.status).toBe("ACTUAL");
    expect(toFixed(r.cost!, 2)).toBe("11000.00");
    expect(r.state.onHand).toBe(dec(1500));
  });

  it("marks cost ESTIMATED when the issue goes below valued stock (OD-04 + OD-03)", () => {
    const s = receive(EMPTY_COST_STATE, dec(50), dec(10));
    const r = issue(s, dec(80));
    expect(r.status).toBe("ESTIMATED");
    expect(r.state.onHand).toBe(dec(-30));
  });

  it("uses a reference price as ESTIMATED, or reports UNAVAILABLE, when no cost exists", () => {
    expect(issue(EMPTY_COST_STATE, dec(10), dec(22)).status).toBe("ESTIMATED");
    const none = issue(EMPTY_COST_STATE, dec(10));
    expect(none.status).toBe("UNAVAILABLE");
    expect(none.cost).toBeNull();
  });

  it("restarts the average at the incoming cost after stock went negative", () => {
    let s = issue(receive(EMPTY_COST_STATE, dec(10), dec(5)), dec(20)).state;
    s = receive(s, dec(30), dec(8));
    expect(toFixed(s.averageCost!, 2)).toBe("8.00");
    expect(s.onHand).toBe(dec(20));
  });

  it("[LEGACY] paper APrice = weight x item rate; Prf is the line cost (TC-CALC-06 / TC-DEC-03)", () => {
    const aprice = legacyPaperUnitCost(dec("4.714839"), 144);
    expect(toFixed(aprice, 2)).toBe("678.94");
    expect(toFixed(legacyLineCost(678.936816, 3, 100, 25), 2)).toBe("2206.54");
    expect(toFixed(legacyPaperUnitCost(weightPer100Sheets({ x: 15, y: 26, gsm: 135 }), 115), 3)).toBe("390.629");
  });
  it("[F-02 / SC-08] reference cost per pack = purchase price + expenses (9 + 0 = 9; 8250 + 11 = 8261)", () => {
    expect(toFixed(referenceCostPerPack({ kind: "OTHER", purchasePrice: 9, expenses: 0 })!, 2)).toBe("9.00");
    expect(toFixed(referenceCostPerPack({ kind: "OTHER", purchasePrice: 8250, expenses: 11 })!, 2)).toBe("8261.00");
    expect(referenceCostPerPack({ kind: "OTHER", purchasePrice: null })).toBeNull();
  });

  it("[F-02] paper reference cost = real packet weight x (rate + expense per kg)", () => {
    const w = weightPerPacket({ x: 20, y: 30, gsm: 80 }, 100);
    expect(toFixed(referenceCostPerPack({ kind: "PAPER", packetWeightKg: w, ratePerKg: 300, expensePerKg: 10 })!, 6)).toBe("960.000000");
    expect(referenceCostPerPack({ kind: "PAPER", packetWeightKg: w, ratePerKg: null })).toBeNull();
  });

  it("[F-02] the reference cost is only an ESTIMATED fallback when no purchase cost exists", () => {
    const perPiece = dec("4.1305"); // 8261 per carton of 2000
    const r = issue(EMPTY_COST_STATE, dec(100), perPiece);
    expect(r.status).toBe("ESTIMATED");
    expect(toFixed(r.cost!, 2)).toBe("413.05");
  });
});
