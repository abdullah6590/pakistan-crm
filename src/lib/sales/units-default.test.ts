// Owner rule (2026-11-16): a product counted in sheets is billed in packets by default, even when its sale or purchase
// unit was left as the sheet; the sheet stays on offer. Pieces and kg are unchanged.
import { describe, expect, it } from "vitest";
import { saleUnitsOf } from "./units";

const profile = (over: Record<string, unknown>) => ({
  unit: "sheet", rimInSheet: 100, itemsPerPackage: 100, packagingUnit: "Packet",
  unitProfile: { kind: "PAPER", baseUnit: "sheet", baseDecimals: 0, purchaseUnit: null, saleUnit: null, confirmed: true, conversions: [{ code: "packet", factor: "100", decimals: 0 }], ...over },
}) as never;

describe("default billing unit", () => {
  it("sheets with a packet: packet by default, sheet still offered (rim board in crm.db)", () => {
    const u = saleUnitsOf(profile({}));
    expect([u.saleUnit, u.purchaseUnit]).toEqual(["packet", "packet"]);
    expect(u.units.map((x) => x.code)).toEqual(["packet", "sheet"]);
  });
  it("a sale unit set to the sheet still defaults to the packet; another pack unit chosen on purpose is kept", () => {
    expect(saleUnitsOf(profile({ saleUnit: "sheet", purchaseUnit: "sheet" })).saleUnit).toBe("packet");
    const ream = saleUnitsOf(profile({ saleUnit: "ream", conversions: [{ code: "packet", factor: "100" }, { code: "ream", factor: "500" }] }));
    expect(ream.saleUnit).toBe("ream");
  });
  it("pieces and kg keep their own unit", () => {
    const box = saleUnitsOf({ unit: "piece", rimInSheet: null, itemsPerPackage: 1, packagingUnit: "Piece", unitProfile: { kind: "PIECE", baseUnit: "piece", baseDecimals: 0, purchaseUnit: null, saleUnit: null, confirmed: false, conversions: [] } } as never);
    expect(box.saleUnit).toBe("piece");
  });
});
