import { describe, expect, it } from "vitest";
import { comboFromEvent, comboProblem, conflicts, defaultShortcuts, mergeShortcuts, normalizeCombo, SHORTCUT_ACTIONS } from "./shortcuts";

const press = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}, key = "x") =>
  comboFromEvent({ code, key, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: false });

describe("keyboard shortcuts", () => {
  it("every default is usable, none is shared, and every section links somewhere", () => {
    const defaults = defaultShortcuts();
    for (const a of SHORTCUT_ACTIONS) {
      expect(comboProblem(a.defaultKey), a.id).toBeNull();
      expect(normalizeCombo(a.defaultKey)).toBe(a.defaultKey);
      expect(a.href.startsWith("/dashboard") || ["#help", "#search"].includes(a.href)).toBe(true);
    }
    expect(conflicts(defaults)).toEqual({});
  });

  it("reads key presses by the physical key, the same on every keyboard layout", () => {
    expect(press("KeyS", { alt: true })).toBe("Alt+S");
    expect(press("KeyS", { alt: true, shift: true })).toBe("Alt+Shift+S");
    expect(press("Slash", { alt: true })).toBe("Alt+/");
    expect(press("Digit3", { ctrl: true, alt: true })).toBe("Ctrl+Alt+3");
    expect(press("F8")).toBe("F8");
    expect(press("AltLeft", { alt: true }, "Alt")).toBeNull(); // only the modifier so far
  });

  it("refuses keys that would fire while typing or that the browser or Windows keep", () => {
    expect(comboProblem("S")).toMatch(/Alt or Ctrl/);
    expect(comboProblem("Shift+S")).toMatch(/capital letters/);
    expect(comboProblem("Alt+D")).toMatch(/address bar/);
    expect(comboProblem("Ctrl+C")).toMatch(/copy/);
    expect(comboProblem("F5")).toMatch(/refresh/);
    expect(comboProblem("Ctrl+2")).toMatch(/switch tabs/);
    expect(comboProblem("F8")).toBeNull();
    expect(comboProblem("Ctrl+Alt+N")).toBeNull();
  });

  it("tidies what is typed, and rejects nonsense", () => {
    expect(normalizeCombo("shift + alt + p")).toBe("Alt+Shift+P");
    expect(normalizeCombo("f9")).toBe("F9");
    expect(normalizeCombo("Alt+Enter")).toBeNull();
    expect(normalizeCombo("Win+S")).toBeNull();
  });

  it("a user's saved keys replace the defaults; bad or unknown entries fall back to the default; empty turns one off", () => {
    const m = mergeShortcuts({ "new-sale": "F8", sales: "Ctrl+C", nonsense: "Alt+Q", inventory: "" });
    expect(m["new-sale"]).toBe("F8");
    expect(m.sales).toBe(defaultShortcuts().sales);
    expect(m.inventory).toBe("");
    expect("nonsense" in m).toBe(false);
    expect(mergeShortcuts("garbage")).toEqual(defaultShortcuts());
  });

  it("uses the old program's keys: Ctrl+B customer invoice, Alt+C cash received, Ctrl+Alt+B stock invoice, Ctrl+Alt+C cash paid", () => {
    const d = defaultShortcuts();
    expect(d["new-sale"]).toBe("Ctrl+B");
    expect(d["receive-payment"]).toBe("Alt+C");
    expect(d["new-purchase"]).toBe("Ctrl+Alt+B");
    expect(d["pay-supplier"]).toBe("Ctrl+Alt+C");
    expect(d.customers).toBe("Alt+Shift+C");
    expect(press("KeyB", { ctrl: true })).toBe("Ctrl+B");
    expect(press("KeyC", { ctrl: true, alt: true })).toBe("Ctrl+Alt+C");
  });

  it("a list saved before the new keys: keys left at the old defaults move to the new ones, chosen keys stay", () => {
    // Saving used to store every key, changed or not
    const old = { ...defaultShortcuts(), "new-sale": "Alt+S", "receive-payment": "Alt+R", "new-purchase": "Alt+P", "pay-supplier": "Alt+Y", customers: "Alt+C", books: "F8" };
    const m = mergeShortcuts(old);
    expect(m["new-sale"]).toBe("Ctrl+B");
    expect(m["receive-payment"]).toBe("Alt+C");
    expect(m["new-purchase"]).toBe("Ctrl+Alt+B");
    expect(m["pay-supplier"]).toBe("Ctrl+Alt+C");
    expect(m.customers).toBe("Alt+Shift+C");
    expect(m.books).toBe("F8");
    expect(conflicts(m)).toEqual({});
  });

  it("a key the user chose wins over a new default that would clash with it; that default is turned off", () => {
    const m = mergeShortcuts({ books: "Ctrl+B" });
    expect(m.books).toBe("Ctrl+B");
    expect(m["new-sale"]).toBe("");
    expect(conflicts(m)).toEqual({});
  });

  it("a list saved with the new keys is taken as it is (version 2)", () => {
    const m = mergeShortcuts({ version: 2, keys: { ...defaultShortcuts(), customers: "Alt+C", "receive-payment": "Alt+R" } });
    expect(m.customers).toBe("Alt+C");
    expect(m["receive-payment"]).toBe("Alt+R");
    expect(m["new-sale"]).toBe("Ctrl+B");
  });

  it("finds two sections given the same keys", () => {
    expect(conflicts({ a: "Alt+S", b: "Alt+S", c: "Alt+P", d: "" })).toEqual({ "Alt+S": ["a", "b"] });
  });
});
