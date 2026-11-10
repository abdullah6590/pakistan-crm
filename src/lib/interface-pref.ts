// src/lib/interface-pref.ts - Which interface a user works in (owner request 2026-11-10): "modern" (the sidebar) or
// "classic" (the old program's menu bar). Kept per user in the settings table, like the keyboard shortcuts; not synced.

export type UiLayout = "modern" | "classic";
export const UI_LAYOUTS: UiLayout[] = ["modern", "classic"];

export const interfaceKey = (userId: string) => `interface:${userId}`;

/** Anything stored or sent that is not "classic" means the modern interface. */
export const parseLayout = (value: unknown): UiLayout => (value === "classic" ? "classic" : "modern");
