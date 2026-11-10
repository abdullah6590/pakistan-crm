// src/components/layout/ledger-picker.tsx - "Customer Ledger" / "Supplier Ledger" in the Classic menu: choose the
// customer or supplier (listed by name, or found by typing), then their ledger opens, as in the old program.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, Search } from "lucide-react";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Hit { id: string; title: string; subtitle: string; badges: { text: string; tone?: string }[] }
interface Result { q: string; hits: Hit[]; hasMore: boolean; error?: string }

const WORDS = { customers: { one: "customer", title: "Customer Ledger" }, suppliers: { one: "supplier", title: "Supplier Ledger" } };

export function LedgerPicker({ kind, onClose }: { kind: "customers" | "suppliers"; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [more, setMore] = useState<{ hits: Hit[]; hasMore: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const words = WORDS[kind];
  const query = q.trim();

  // The list follows what is typed (a short pause first; an older answer never replaces a newer one)
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?group=${kind}&browse=1&q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || "Could not load the list");
          setResult({ q: query, hits: data.hits ?? [], hasMore: !!data.hasMore });
          setMore(null);
          setActive(0);
        })
        .catch((e) => { if (e.name !== "AbortError") setResult({ q: query, hits: [], hasMore: false, error: e.message }); });
    }, query ? 180 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [kind, query]);

  const loading = !result || result.q !== query;
  const hits = loading ? [] : [...result.hits, ...(more?.hits ?? [])];
  const hasMore = loading ? false : more ? more.hasMore : result.hasMore;

  const open = (id: string) => { onClose(); router.push(`/dashboard/${kind}/${id}/ledger`); };

  async function showMore() {
    const r = await fetch(`/api/search?group=${kind}&browse=1&q=${encodeURIComponent(query)}&skip=${hits.length}`);
    const data = await r.json().catch(() => ({}));
    if (r.ok) setMore({ hits: [...(more?.hits ?? []), ...(data.hits ?? [])], hasMore: !!data.hasMore });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      setActive(next);
      listRef.current?.querySelectorAll("[role=option]")[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(hits[active].id);
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{words.title}</DialogTitle>
        <DialogDescription>Choose the {words.one}; their ledger opens.</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Name, phone or city of the ${words.one}`}
          className="pl-9"
          role="combobox"
          aria-expanded
          aria-controls="ledger-picker-list"
          aria-activedescendant={hits[active] ? `ledger-pick-${hits[active].id}` : undefined}
          aria-label={`Find the ${words.one}`}
        />
      </div>
      <div className="mt-3 min-h-40" aria-live="polite">
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading...</p>
        ) : result?.error ? (
          <p className="py-6 text-center text-sm text-destructive">{result.error}</p>
        ) : hits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{query ? `No ${words.one} matches "${query}".` : `No ${kind} yet.`}</p>
        ) : (
          <ul id="ledger-picker-list" ref={listRef} role="listbox" aria-label={`${words.one} list`} className="max-h-80 overflow-y-auto rounded-lg border divide-y">
            {hits.map((h, i) => (
              <li
                key={h.id}
                id={`ledger-pick-${h.id}`}
                role="option"
                aria-selected={i === active}
                onClick={() => open(h.id)}
                onMouseMove={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5", i === active && "bg-muted")}
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.title}</span>
                  {h.subtitle && <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                </span>
                {h.badges.map((b) => (
                  <span key={b.text} className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs", b.tone === "bad" ? "bg-red-500/10 text-red-700 dark:text-red-300" : b.tone === "warn" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : b.tone === "good" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{b.text}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
        {hasMore && <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={showMore}>Show more</Button>}
      </div>
    </Dialog>
  );
}
