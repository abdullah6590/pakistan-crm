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

  it("finds two sections given the same keys", () => {
    expect(conflicts({ a: "Alt+S", b: "Alt+S", c: "Alt+P", d: "" })).toEqual({ "Alt+S": ["a", "b"] });
  });
});
