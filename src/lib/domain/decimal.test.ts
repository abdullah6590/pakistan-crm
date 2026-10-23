import { describe, expect, it } from "vitest";
import { dec, add, mul, div, roundHalfEven, toFixed, sum, hasAtMostDecimals } from "./decimal";

describe("decimal (exact money arithmetic, audit BUG-14)", () => {
  it("adds 3 x 0.10 exactly", () => {
    expect(toFixed(sum([dec("0.1"), dec("0.1"), dec("0.1")]), 2)).toBe("0.30");
    expect(mul(dec(3), dec("0.1"))).toBe(dec("0.3"));
  });

  it("parses numbers, strings and exponents exactly", () => {
    expect(dec("1e-3")).toBe(dec("0.001"));
    expect(dec(-12.5)).toBe(dec("-12.5"));
    // 10th decimal is exactly 5 and the 9th is even, so half-to-even keeps ...064
    expect(toFixed(dec("929.0322580645"), 9)).toBe("929.032258064");
    expect(toFixed(dec("929.0322580655"), 9)).toBe("929.032258066");
  });

  it("rounds half to even like the legacy .NET client", () => {
    expect(toFixed(roundHalfEven(dec("202663.5"), 0), 0)).toBe("202664");
    expect(toFixed(roundHalfEven(dec("797726.5"), 0), 0)).toBe("797726");
    expect(toFixed(roundHalfEven(dec("2.5"), 0), 0)).toBe("2");
    expect(toFixed(roundHalfEven(dec("-0.5"), 0), 0)).toBe("0");
    expect(toFixed(roundHalfEven(dec("1.005"), 2), 2)).toBe("1.00");
  });

  it("divides with explicit rounding and rejects division by zero", () => {
    expect(toFixed(div(dec(1), dec(3)), 9)).toBe("0.333333333");
    expect(() => div(dec(1), dec(0))).toThrow();
    expect(add(dec("0.000000000001"), dec("0.000000000001"))).toBe(dec("0.000000000002"));
    expect(hasAtMostDecimals(dec("4.125"), 3)).toBe(true);
    expect(hasAtMostDecimals(dec("4.1255"), 3)).toBe(false);
  });
});
