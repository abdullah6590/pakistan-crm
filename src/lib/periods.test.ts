import { describe, expect, it } from "vitest";
import { asOfDates, periods } from "./periods";

const byKey = <T extends { key: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.key, x]));

describe("quick date choices", () => {
  it("in November 2026: this month, last month and the financial year July 2026 to June 2027", () => {
    const p = byKey(periods(new Date(2026, 10, 3)));
    expect(p.today).toMatchObject({ from: "2026-11-03", to: "2026-11-03" });
    expect(p["this-month"]).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(p["last-month"]).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(p["this-fy"]).toMatchObject({ from: "2026-07-01", to: "2027-06-30", label: "This financial year (2026-27)" });
    expect(p["last-fy"]).toMatchObject({ from: "2025-07-01", to: "2026-06-30" });
  });

  it("in January the previous month is December of last year, and the financial year started last July", () => {
    const p = byKey(periods(new Date(2027, 0, 15)));
    expect(p["last-month"]).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(p["this-fy"]).toMatchObject({ from: "2026-07-01", to: "2027-06-30" });
  });

  it("in June the financial year is still the one that started last July; February has its leap day", () => {
    expect(byKey(periods(new Date(2027, 5, 30)))["this-fy"]).toMatchObject({ from: "2026-07-01", to: "2027-06-30" });
    expect(byKey(periods(new Date(2028, 2, 10)))["last-month"]).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("as-on dates: today, end of last month, end of last financial year", () => {
    const a = byKey(asOfDates(new Date(2026, 10, 3)));
    expect([a.today.to, a["end-last-month"].to, a["end-last-fy"].to]).toEqual(["2026-11-03", "2026-10-31", "2026-06-30"]);
  });
});
