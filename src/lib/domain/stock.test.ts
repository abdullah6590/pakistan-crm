import { describe, expect, it } from "vitest";
import { dec } from "./decimal";
import { applyMovement } from "./stock";

describe("negative stock policy (OD-04)", () => {
  it("allows the sale, records the negative balance and warns (TC-DEC-04)", () => {
    const r = applyMovement(dec(50), dec(-80));
    expect(r.allowed).toBe(true);
    expect(r.balanceAfter).toBe(dec(-30));
    expect(r.warning?.balanceAfter).toBe(dec(-30));
  });

  it("does not warn for normal movements or receipts into negative stock", () => {
    expect(applyMovement(dec(50), dec(-20)).warning).toBeUndefined();
    expect(applyMovement(dec(-30), dec(10)).warning).toBeUndefined();
  });

  it("is configurable: BLOCK keeps the balance unchanged", () => {
    const r = applyMovement(dec(50), dec(-80), "BLOCK");
    expect(r.allowed).toBe(false);
    expect(r.balanceAfter).toBe(dec(50));
    expect(applyMovement(dec(50), dec(-80), "ALLOW_SILENT").warning).toBeUndefined();
  });
});
