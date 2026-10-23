import { describe, expect, it } from "vitest";
import { dec, toFixed } from "./decimal";
import { weightPer100Sheets, weightPerPacket, legacyPacketWeight, packetPriceFromRate, priceLine, legacyLineAmount } from "./pricing";
import { DEFAULT_UNITS } from "./units";

describe("pricing", () => {
  it("[LEGACY] BR-01 weight of 100 sheets = X*Y*GSM/15500 (TC-CALC-01)", () => {
    expect(toFixed(weightPer100Sheets({ x: 20, y: 30, gsm: 80 }), 6)).toBe("3.096774");
    expect(weightPer100Sheets({ x: 0, y: 30, gsm: 80 })).toBe(dec(0));
  });

  it("[LEGACY] BR-04 packet price = rate x weight, unrounded (TC-CALC-05)", () => {
    const w = weightPer100Sheets({ x: 20, y: 30, gsm: 80 });
    expect(toFixed(packetPriceFromRate(300, w), 6)).toBe("929.032258");
  });

  it("[LEGACY] BR-05 line amount with loose sheets (TC-CALC-04)", () => {
    const line = priceLine({ unit: DEFAULT_UNITS.PAPER, quantity: { quantity: 3, unit: "packet", loose: 25 }, unitPrice: 1250 });
    expect(toFixed(line.amount, 2)).toBe("4062.50");
    expect(toFixed(line.loosePrice, 2)).toBe("12.50");
    expect(line.baseQuantity).toBe(dec(325));
    expect(toFixed(legacyLineAmount(1250, 3, 100, 25), 2)).toBe("4062.50");
  });

  it("[OD-02] 200-sheet packet is priced by its full weight (TC-DEC-02)", () => {
    const dims = { x: 15, y: 26, gsm: 135 };
    expect(toFixed(weightPer100Sheets(dims), 6)).toBe("3.396774");
    const newPrice = packetPriceFromRate(115, weightPerPacket(dims, 200));
    const legacyPrice = packetPriceFromRate(115, legacyPacketWeight(dims));
    const unit = { kind: "PAPER" as const, baseUnit: "sheet", conversions: [{ code: "packet", factor: 200 }] };
    const approved = priceLine({ unit, quantity: { quantity: 5, unit: "packet" }, unitPrice: newPrice });
    expect(toFixed(approved.amount, 2)).toBe("3906.29");
    expect(approved.baseQuantity).toBe(dec(1000));
    // Legacy billed the weight of 500 sheets while deducting 1000 (flagged for the impact report)
    expect(toFixed(legacyLineAmount(Number(toFixed(legacyPrice, 9)), 5, 200, 0), 2)).toBe("1953.15");
  });

  it("[OD-06] pieces, kg and services price per base unit (TC-CALC-22)", () => {
    expect(toFixed(priceLine({ unit: DEFAULT_UNITS.PIECE, quantity: { quantity: 1900 }, unitPrice: 26 }).amount, 2)).toBe("49400.00");
    expect(toFixed(priceLine({ unit: DEFAULT_UNITS.WEIGHT, quantity: { quantity: "4.5" }, unitPrice: 1730 }).amount, 2)).toBe("7785.00");
    expect(toFixed(priceLine({ unit: DEFAULT_UNITS.SERVICE, quantity: { quantity: 1 }, unitPrice: 2670 }).amount, 2)).toBe("2670.00");
  });

  it("[F-01 / SC-09] carton price applies to non-paper items; loose pieces at carton price / C in Q", () => {
    const cups = { kind: "PIECE" as const, baseUnit: "piece", conversions: [{ code: "carton", factor: 2000 }] };
    const line = priceLine({ unit: cups, quantity: { quantity: 5, unit: "carton", loose: 500 }, unitPrice: 9000 });
    expect(line.baseQuantity).toBe(dec(10500));
    expect(toFixed(line.loosePrice, 2)).toBe("4.50");
    expect(toFixed(line.amount, 2)).toBe("47250.00");
  });

  it("rejects negative prices", () => {
    expect(() => priceLine({ unit: DEFAULT_UNITS.PIECE, quantity: { quantity: 1 }, unitPrice: -1 })).toThrow();
  });
});
