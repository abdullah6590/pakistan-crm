// src/lib/shortcuts.ts - Keyboard shortcuts for the main sections. Every user can change their own keys (Settings ->
// Keyboard shortcuts); these are the defaults. Shared by the screens and the server, so no server-only imports here.

export interface ShortcutAction { id: string; label: string; group: string; href: string; defaultKey: string }

/**
 * The main sections a key can open. Defaults avoid the keys the browser keeps for itself; the four daily entries use
 * the old program's keys (owner, 2026-11-10): Ctrl+B customer invoice, Alt+C cash received, Ctrl+Alt+B stock invoice,
 * Ctrl+Alt+C cash paid.
 */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "dashboard", label: "Dashboard", group: "General", href: "/dashboard", defaultKey: "Alt+H" },
  { id: "search", label: "Search everything", group: "General", href: "#search", defaultKey: "Ctrl+K" },
  { id: "help", label: "Show the list of shortcuts", group: "General", href: "#help", defaultKey: "Alt+/" },
  { id: "new-sale", label: "Customer invoice (new sale)", group: "Sales", href: "/dashboard/sales/new", defaultKey: "Ctrl+B" },
  { id: "sales", label: "Sales bills", group: "Sales", href: "/dashboard/sales", defaultKey: "Alt+Shift+S" },
  { id: "receive-payment", label: "Cash received (receive payment)", group: "Sales", href: "/dashboard/sales/payments", defaultKey: "Alt+C" },
  { id: "receivables", label: "Outstanding (customers owe)", group: "Sales", href: "/dashboard/sales/receivables", defaultKey: "Alt+Shift+R" },
  { id: "customers", label: "Customers", group: "Sales", href: "/dashboard/customers", defaultKey: "Alt+Shift+C" },
  { id: "new-purchase", label: "Stock invoice (new purchase)", group: "Purchases", href: "/dashboard/purchases/new", defaultKey: "Ctrl+Alt+B" },
  { id: "purchases", label: "Purchase bills", group: "Purchases", href: "/dashboard/purchases", defaultKey: "Alt+Shift+P" },
  { id: "pay-supplier", label: "Cash paid (pay supplier)", group: "Purchases", href: "/dashboard/purchases/pay", defaultKey: "Ctrl+Alt+C" },
  { id: "payables", label: "Payables (you owe)", group: "Purchases", href: "/dashboard/purchases/payables", defaultKey: "Alt+Shift+Y" },
  { id: "suppliers", label: "Suppliers", group: "Purchases", href: "/dashboard/suppliers", defaultKey: "Alt+U" },
  { id: "inventory", label: "Inventory", group: "Stock", href: "/dashboard/inventory", defaultKey: "Alt+I" },
  { id: "stock", label: "Stock position", group: "Stock", href: "/dashboard/accounting/reports?report=stock", defaultKey: "Alt+Shift+I" },
  { id: "books", label: "Books", group: "Books", href: "/dashboard/accounting", defaultKey: "Alt+B" },
  { id: "ledger", label: "Account ledger", group: "Books", href: "/dashboard/accounting/ledger", defaultKey: "Alt+L" },
  { id: "cash-book", label: "Cash / bank book", group: "Books", href: "/dashboard/accounting/reports?report=cash-book", defaultKey: "Alt+K" },
  { id: "daybook", label: "Daybook", group: "Books", href: "/dashboard/accounting/reports?report=daybook", defaultKey: "Alt+J" },
  { id: "profit-loss", label: "Profit & Loss", group: "Books", href: "/dashboard/accounting/reports?report=profit-loss", defaultKey: "Alt+O" },
  { id: "party-balances", label: "Party balances", group: "Books", href: "/dashboard/accounting/reports?report=party-balances", defaultKey: "Alt+Shift+B" },
  { id: "backups", label: "Backups", group: "Books", href: "/dashboard/accounting/backups", defaultKey: "Alt+Shift+K" },
];

export type ShortcutMap = Record<string, string>;

export function defaultShortcuts(): ShortcutMap {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey]));
}

const MODIFIERS = ["Ctrl", "Alt", "Shift"] as const;
const KEY_NAME = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|[/\\.,;'[\]=\-`])$/;

/** "alt + shift + s" -> "Alt+Shift+S"; null when it is not a usable key combination. */
export function normalizeCombo(text: string): string | null {
  const parts = text.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const rawKey = parts.pop()!;
  const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey.toUpperCase().replace(/^F(\d+)$/, "F$1");
  if (!KEY_NAME.test(key)) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  for (const m of mods) if (!["ctrl", "alt", "shift"].includes(m)) return null;
  return [...MODIFIERS.filter((m) => mods.has(m.toLowerCase())), key].join("+");
}

/** The combination a key press makes ("Alt+S"), or null for a lone modifier key. Uses the physical key, so Alt+S
 *  works the same on every keyboard layout and is not changed by Shift (Shift+/ is "Shift+/", not "?"). */
export function comboFromEvent(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) return null;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else key = ({ Slash: "/", Backslash: "\\", Period: ".", Comma: ",", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Backquote: "`" } as Record<string, string>)[e.code] ?? null;
  if (!key) return null;
  const mods = [e.ctrlKey || e.metaKey ? "Ctrl" : null, e.altKey ? "Alt" : null, e.shiftKey ? "Shift" : null].filter(Boolean);
  return [...mods, key].join("+");
}

/**
 * Why a combination cannot be used, or null when it can. Plain letters and digits would fire while typing; the rest are
 * kept by Windows or the browser (copy, paste, new tab, address bar, refresh, developer tools, ...).
 */
export function comboProblem(combo: string): string | null {
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const fKey = /^F([1-9]|1[0-2])$/.test(key);
  if (!mods.length && !fKey) return "Add Alt or Ctrl, so the key does not fire while you type";
  if (mods.length === 1 && mods[0] === "Shift" && !fKey) return "Shift alone types capital letters: add Alt or Ctrl";
  const reserved: Record<string, string> = {
    "F1": "help", "F3": "find", "F5": "refresh", "F6": "address bar", "F7": "caret browsing", "F11": "full screen", "F12": "developer tools",
    "Alt+D": "address bar", "Alt+E": "browser menu", "Alt+F": "browser menu", "Alt+F4": "close the window", "Alt+Tab": "switch windows",
    "Ctrl+A": "select all", "Ctrl+C": "copy", "Ctrl+V": "paste", "Ctrl+X": "cut", "Ctrl+Z": "undo", "Ctrl+Y": "redo", "Ctrl+P": "print",
    "Ctrl+S": "save page", "Ctrl+F": "find", "Ctrl+N": "new window", "Ctrl+T": "new tab", "Ctrl+W": "close tab", "Ctrl+R": "refresh",
    "Ctrl+L": "address bar", "Ctrl+H": "history", "Ctrl+J": "downloads", "Ctrl+D": "bookmark", "Ctrl+Shift+T": "reopen tab",
    "Ctrl+Shift+N": "private window", "Ctrl+Shift+I": "developer tools", "Ctrl+Shift+J": "developer tools", "Ctrl+Shift+Delete": "clear data",
  };
  for (let n = 1; n <= 9; n++) reserved[`Ctrl+${n}`] = "switch tabs";
  return reserved[combo] ? `The browser or Windows uses ${combo} (${reserved[combo]})` : null;
}

/** Saved lists carry this version; lists saved before it hold every key, changed or not, under the old defaults. */
export const SHORTCUTS_VERSION = 2;
const OLD_DEFAULTS: Record<string, string> = { "new-sale": "Alt+S", "receive-payment": "Alt+R", "new-purchase": "Alt+P", "pay-supplier": "Alt+Y", customers: "Alt+C" };

/** What is stored for a user: the whole list with the version, so later default changes can tell chosen keys apart. */
export const savedShortcuts = (keys: ShortcutMap) => ({ version: SHORTCUTS_VERSION, keys });

/**
 * The user's saved keys over the defaults; unknown actions and unusable keys are dropped (back to the default). In a
 * list saved before version 2 a key equal to the old default was never chosen, so it takes the new default. A key the
 * user chose wins over a default that would clash with it, and that default is turned off.
 */
export function mergeShortcuts(saved: unknown): ShortcutMap {
  const defaults = defaultShortcuts();
  const result = { ...defaults };
  if (!saved || typeof saved !== "object") return result;
  const s = saved as Record<string, unknown>;
  const versioned = typeof s.version === "number" && !!s.keys && typeof s.keys === "object";
  const entries = Object.entries((versioned ? s.keys : s) as Record<string, unknown>);
  const chosen = new Set<string>();
  for (const [id, value] of entries) {
    if (!(id in defaults)) continue;
    if (!versioned && OLD_DEFAULTS[id] === value) continue; // left at the old default
    if (value === "") { result[id] = ""; chosen.add(id); continue; } // turned off
    const combo = typeof value === "string" ? normalizeCombo(value) : null;
    if (!combo || comboProblem(combo)) continue;
    result[id] = combo;
    if (combo !== defaults[id]) chosen.add(id);
  }
  const taken = new Set([...chosen].map((id) => result[id]).filter(Boolean));
  for (const id of Object.keys(result)) if (!chosen.has(id) && result[id] && taken.has(result[id])) result[id] = "";
  return result;
}

/** Combinations given to more than one section: combo -> the action ids using it. */
export function conflicts(map: ShortcutMap): Record<string, string[]> {
  const byCombo: Record<string, string[]> = {};
  for (const [id, combo] of Object.entries(map)) if (combo) (byCombo[combo] ??= []).push(id);
  return Object.fromEntries(Object.entries(byCombo).filter(([, ids]) => ids.length > 1));
}
