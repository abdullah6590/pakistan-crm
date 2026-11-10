// src/components/layout/classic-menu-bar.tsx - The Classic interface's menu bar and quick-launch strip (owner request
// 2026-11-10), laid out like the old program. Keyboard: Tab reaches the bar, Left/Right move between tabs (and between
// open menus), Enter/Space/Down open a menu, Up/Down move inside it, Esc closes it. Each item shows the user's own key.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { menuForPath, type ClassicItem, type ClassicMenu } from "@/lib/classic-menu";
import { defaultShortcuts, type ShortcutMap } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { ClassicIcon } from "./classic-icons";
import { LedgerPicker } from "./ledger-picker";

/** The signed-in user's keys (the defaults until their own have loaded). */
function useShortcutKeys(): ShortcutMap {
  const [keys, setKeys] = useState<ShortcutMap>(defaultShortcuts);
  useEffect(() => {
    let alive = true;
    fetch("/api/me/shortcuts").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.shortcuts) setKeys(d.shortcuts); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return keys;
}

const Kbd = ({ combo }: { combo: string }) => (
  <kbd className="ml-auto shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground">{combo.replace(/\+/g, " + ")}</kbd>
);

function ItemRow({ item, keys }: { item: ClassicItem; keys: ShortcutMap }) {
  const combo = item.shortcut ? keys[item.shortcut] : "";
  return (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80" aria-hidden><ClassicIcon name={item.icon} className="h-4 w-4" /></span>
      <span className="flex-1 truncate">{item.label}</span>
      {combo ? <Kbd combo={combo} /> : null}
    </>
  );
}

const TAB = "flex h-14 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted cursor-pointer";

export function ClassicMenuBar({ menus }: { menus: ClassicMenu[] }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const keys = useShortcutKeys();
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState<"customers" | "suppliers" | null>(null);
  const tabs = useRef<(HTMLElement | null)[]>([]);
  const current = menuForPath(menus, pathname, search.toString());
  // Set while one menu hands over to the next: the closing menu must not pull the focus back to its tab, or the menu
  // that has just opened sees the focus leave and closes again
  const switching = useRef(false);
  const switchTo = (id: string | null) => {
    switching.current = true;
    setOpen(id);
    setTimeout(() => { switching.current = false; }, 300);
  };

  const neighbour = (i: number, step: number) => (i + step + menus.length) % menus.length;

  // Left/Right on a tab moves to the next tab; if a menu is open, the next menu opens instead
  function onTabKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      tabs.current[e.key === "Home" ? 0 : menus.length - 1]?.focus();
      return;
    }
    if (!step) return;
    e.preventDefault();
    const next = neighbour(i, step);
    tabs.current[next]?.focus();
    if (open) switchTo(menus[next].items.length > 1 ? menus[next].id : null);
  }

  // Left/Right inside an open menu opens the menu beside it
  function onMenuKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = neighbour(i, e.key === "ArrowRight" ? 1 : -1);
    // A tab without a menu (Cash Sale, Backup) takes the focus; otherwise its menu opens and the focus moves into it
    if (menus[next].items.length === 1) { setOpen(null); tabs.current[next]?.focus(); return; }
    switchTo(menus[next].id);
  }

  return (
    <>
      <nav aria-label="Main menu" className="border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70 print:hidden">
        <ul className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 lg:px-4">
          {menus.map((m, i) => {
            const active = current === m.id;
            const tile = <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", m.tone)} aria-hidden><ClassicIcon name={m.icon} className="h-5 w-5" /></span>;
            const marker = active ? <span className="absolute inset-x-3 -bottom-1.5 h-0.5 rounded-full bg-primary" aria-hidden /> : null;
            if (m.items.length === 1 && m.items[0].href) {
              const item = m.items[0];
              const combo = item.shortcut ? keys[item.shortcut] : "";
              return (
                <li key={m.id} className="relative">
                  <Link
                    href={item.href!}
                    ref={(el) => { tabs.current[i] = el; }}
                    onKeyDown={(e) => onTabKey(e, i)}
                    aria-current={active ? "page" : undefined}
                    title={combo ? `${item.label} (${combo})` : item.label}
                    className={cn(TAB, active && "bg-muted")}
                  >
                    {tile}<span>{m.label}</span>
                  </Link>
                  {marker}
                </li>
              );
            }
            return (
              <li key={m.id} className="relative" onPointerEnter={() => { if (open && open !== m.id) switchTo(m.id); }}>
                <DropdownMenu modal={false} open={open === m.id} onOpenChange={(o) => setOpen(o ? m.id : null)}>
                  <DropdownMenuTrigger
                    ref={(el) => { tabs.current[i] = el; }}
                    onKeyDown={(e) => onTabKey(e, i)}
                    aria-current={active ? "true" : undefined}
                    className={cn(TAB, active && "bg-muted")}
                  >
                    {tile}<span>{m.label}</span><ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={6} className="w-80 p-1.5" onKeyDown={(e) => onMenuKey(e, i)} onCloseAutoFocus={(e) => { if (switching.current) e.preventDefault(); }} aria-label={`${m.label} menu`}>
                    {m.items.map((item) => (
                      <div key={item.id}>
                        {item.group && <DropdownMenuSeparator />}
                        {item.href ? (
                          <DropdownMenuItem asChild className="gap-3 py-1.5 text-sm cursor-pointer">
                            <Link href={item.href}><ItemRow item={item} keys={keys} /></Link>
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem className="gap-3 py-1.5 text-sm cursor-pointer" onSelect={() => setPicker(item.picker!)}>
                            <ItemRow item={item} keys={keys} />
                          </DropdownMenuItem>
                        )}
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {marker}
              </li>
            );
          })}
        </ul>
      </nav>
      {picker && <LedgerPicker key={picker} kind={picker} onClose={() => setPicker(null)} />}
    </>
  );
}

/** The narrow strip of large buttons on the left, for the screens used all day (the items marked `quick`). */
export function QuickStrip({ menus }: { menus: ClassicMenu[] }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const keys = useShortcutKeys();
  const items = menus.flatMap((m) => m.items.filter((i) => i.quick && i.href));
  if (!items.length) return null;
  const here = `${pathname}${search.toString() ? `?${search}` : ""}`;
  return (
    <aside aria-label="Quick buttons" className="hidden w-[92px] shrink-0 border-r bg-card/50 lg:block print:hidden">
      {/* Stays in view below the title bar (64px) and the menu bar (about 69px) while the page scrolls */}
      <ul className="sticky top-[134px] flex flex-col gap-1 p-2">
        {items.map((i) => {
          const combo = i.shortcut ? keys[i.shortcut] : "";
          const active = here === i.href;
          return (
            <li key={i.id}>
              <Link
                href={i.href!}
                title={combo ? `${i.label} (${combo})` : i.label}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-center text-xs leading-tight transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "bg-muted font-medium")}
              >
                <ClassicIcon name={i.icon} className="h-6 w-6 text-foreground/80" />
                <span>{i.quick}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
