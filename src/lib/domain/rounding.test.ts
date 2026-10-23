import { describe, expect, it } from "vitest";
import { dec, toFixed } from "./decimal";
import { documentTotal, legacyInvoiceTotal } from "./rounding";

describe("document totals (OD-01)", () => {
  it("[LEGACY] sale total rounds half-to-even to whole rupees (TC-CALC-21)", () => {
    expect(toFixed(legacyInvoiceTotal([dec("202663.5")]), 0)).toBe("202664");
    expect(toFixed(legacyInvoiceTotal([dec("797726.5")]), 0)).toBe("797726");
    expect(toFixed(legacyInvoiceTotal([dec("1000.49")]), 0)).toBe("1000");
  });

  it("[OD-01] posted total equals printed total; difference is an explicit adjustment (TC-DEC-01)", () => {
    const lines = [dec("2787.096774"), dec("2690.167742")];
    const t = documentTotal(lines, "RUPEE_HALF_EVEN");
    expect(toFixed(t.exact, 6)).toBe("5477.264516");
    expect(toFixed(t.total, 2)).toBe("5477.00");
    expect(toFixed(t.roundingAdjustment, 6)).toBe("-0.264516");
  });

  it("purchase totals keep paisa precision by default (legacy never rounded purchases)", () => {
    const t = documentTotal([dec("93001.6"), dec("0.004")], "PAISA_HALF_EVEN");
    expect(toFixed(t.total, 2)).toBe("93001.60");
  });
});
