import { describe, expect, it } from "vitest";
import { dec, toFixed } from "./decimal";
import { toBaseQuantity, toPacksAndLoose, legacyBaseQuantity, pricePerBaseUnit, validateUnitConfig, DEFAULT_UNITS, QuantityError, ItemUnitConfig } from "./units";

const paper100: ItemUnitConfig = { kind: "PAPER", baseUnit: "sheet", conversions: [{ code: "packet", factor: 100 }] };
const paper200: ItemUnitConfig = { kind: "PAPER", baseUnit: "sheet", conversions: [{ code: "packet", factor: 200 }] };
const cups: ItemUnitConfig = { kind: "PIECE", baseUnit: "piece", conversions: [{ code: "carton", factor: 2000 }], purchaseUnit: "carton", saleUnit: "carton" };
const testLiner: ItemUnitConfig = { kind: "WEIGHT", baseUnit: "kg", baseDecimals: 3, conversions: [{ code: "roll", factor: "212.5", decimals: 0 }] };

describe("units (OD-06, F-01)", () => {
  it("[LEGACY] paper: 3 packets of 100 + 25 loose = 325 sheets (TC-CALC-03)", () => {
    expect(toBaseQuantity(paper100, { quantity: 3, unit: "packet", loose: 25 })).toBe(dec(325));
  });

  it("[OD-02] a 200-sheet packet counts 200 sheets", () => {
    expect(toBaseQuantity(paper200, { quantity: 5, unit: "packet" })).toBe(dec(1000));
    expect(toBaseQuantity(paper200, { quantity: 5, unit: "packet", loose: 10 })).toBe(dec(1010));
    expect(toBaseQuantity(paper200, { quantity: 40 })).toBe(dec(40)); // loose sheets only
  });

  it("[F-01 / SC-09] any item may have a pack: 5 cartons x 2000 = 10,000 pieces, plus loose pieces", () => {
    expect(toBaseQuantity(cups, { quantity: 5, unit: "carton" })).toBe(dec(10000));
    expect(toBaseQuantity(cups, { quantity: 5, unit: "carton", loose: 150 })).toBe(dec(10150));
    expect(toFixed(pricePerBaseUnit(cups, dec(8261), "carton"), 6)).toBe("4.130500"); // carton price / C in Q
  });

  it("[OD-06] boxes without a configured pack are pieces with no multiplier (TC-CALC-22 / TC-DEC-06)", () => {
    expect(toBaseQuantity(DEFAULT_UNITS.PIECE, { quantity: 1900 })).toBe(dec(1900));
    expect(legacyBaseQuantity(1900, 100, 0)).toBe(dec(190000)); // legacy inflated stock 100x
  });

  it("[OD-06] kg allows fractional quantities up to 3 decimals; a pack of kg may be fractional", () => {
    expect(toBaseQuantity(DEFAULT_UNITS.WEIGHT, { quantity: "4.5" })).toBe(dec("4.5"));
    expect(() => toBaseQuantity(DEFAULT_UNITS.WEIGHT, { quantity: "4.5001" })).toThrow(QuantityError);
    expect(toBaseQuantity(testLiner, { quantity: 2, unit: "roll", loose: "10.25" })).toBe(dec("435.25"));
    expect(() => toBaseQuantity(testLiner, { quantity: "1.5", unit: "roll" })).toThrow(/whole numbers/);
  });

  it("rejects invalid quantities and configurations", () => {
    expect(() => toBaseQuantity(DEFAULT_UNITS.PIECE, { quantity: "1.5" })).toThrow(QuantityError);
    expect(() => toBaseQuantity(paper100, { quantity: -1, unit: "packet" })).toThrow(QuantityError);
    expect(() => toBaseQuantity(paper100, { quantity: 1, unit: "packet", loose: 100 })).toThrow(/fewer than one packet \(100\)/);
    expect(() => toBaseQuantity(DEFAULT_UNITS.PIECE, { quantity: 5, loose: 3 })).toThrow(/together with a pack unit/);
    expect(() => toBaseQuantity(cups, { quantity: 1, unit: "packet" })).toThrow(/not defined/);
    expect(() => toBaseQuantity({ kind: "PAPER", baseUnit: "sheet" }, { quantity: 1 })).toThrow(/packet size/);
    expect(() => validateUnitConfig({ kind: "PIECE", baseUnit: "piece", conversions: [{ code: "carton", factor: 0 }] })).toThrow(/positive/);
    expect(() => validateUnitConfig({ kind: "PIECE", baseUnit: "piece", conversions: [{ code: "piece", factor: 10 }] })).toThrow(/more than once/);
    expect(() => validateUnitConfig({ kind: "PIECE", baseUnit: "piece", saleUnit: "carton" })).toThrow(/not defined/);
  });

  it("displays stock as packs + loose for any item with a pack", () => {
    const r = toPacksAndLoose(paper200, dec(1010))!;
    expect([toFixed(r.packs, 0), toFixed(r.loose, 0), r.unit]).toEqual(["5", "10", "packet"]);
    const c = toPacksAndLoose(cups, dec(10150))!;
    expect([toFixed(c.packs, 0), toFixed(c.loose, 0)]).toEqual(["5", "150"]);
    const n = toPacksAndLoose(cups, dec(-2500))!; // negative stock (OD-04) keeps its sign
    expect([toFixed(n.packs, 0), toFixed(n.loose, 0)]).toEqual(["-1", "-500"]);
    expect(toPacksAndLoose(DEFAULT_UNITS.PIECE, dec(5))).toBeNull();
  });
});
