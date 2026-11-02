import { describe, expect, it } from "vitest";
import { specLabel } from "./product-spec";

describe("size and grams label", () => {
  it("shows size and grams together, either alone, or nothing", () => {
    expect(specLabel({ size: "20x39", grams: 200 })).toBe("20x39 · 200g");
    expect(specLabel({ size: "25x30", grams: null })).toBe("25x30");
    expect(specLabel({ size: null, grams: 210 })).toBe("210g");
    expect(specLabel({ size: "  ", grams: 0 })).toBe("");
    expect(specLabel(null)).toBe("");
  });

  it("keeps decimal grams as entered", () => {
    expect(specLabel({ size: "A4", grams: 80.5 })).toBe("A4 · 80.5g");
  });
});
