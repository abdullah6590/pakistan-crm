// src/lib/interface-pref.test.ts - Who is asked "Choose your layout", and how a stored choice is read.
import { describe, expect, it } from "vitest";
import { needsLayoutChoice, parseLayout } from "./interface-pref";

describe("layout choice", () => {
  it("asks users with no choice stored: new users and those coming from 0.1.6 or older", () => {
    expect(needsLayoutChoice(undefined)).toBe(true);
    expect(needsLayoutChoice(null)).toBe(true);
    expect(needsLayoutChoice("")).toBe(true);
    expect(needsLayoutChoice("something else")).toBe(true);
  });

  it("does not ask again once Modern or Classic is chosen", () => {
    expect(needsLayoutChoice("modern")).toBe(false);
    expect(needsLayoutChoice("classic")).toBe(false);
  });

  it("works in Modern until Classic is chosen", () => {
    expect(parseLayout(undefined)).toBe("modern");
    expect(parseLayout("modern")).toBe("modern");
    expect(parseLayout("classic")).toBe("classic");
  });
});
