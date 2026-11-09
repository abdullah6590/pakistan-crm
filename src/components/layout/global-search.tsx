"use client";
// src/components/layout/global-search.tsx - Search everything from any page (header search box or Ctrl+K): customers,
// suppliers, products, sale and purchase bills, payments and pages, grouped, best match first, "Show more" per group.
// Requests wait until typing pauses, the previous one is cancelled, and answers are remembered, so it never hangs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight, Building2, Clock, CornerDownLeft, FileText, Loader2, Package, Receipt, Search, ShoppingCart, Sparkles, Truck, Users, Wallet, X,
} from "lucide-react";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts";

export const OPEN_SEARCH = "crm-open-search";

type GroupId = "customers" | "suppliers" | "products" | "sales" | "purchases" | "payments";
interface Hit { id: string; group: GroupId; title: string; subtitle: string; badges: { text: string; tone?: "good" | "warn" | "bad" | "muted" }[]; amount: string | null; date: string | null; href: string; rank: number }
interface GroupResult { group: GroupId; hits: Hit[]; hasMore: boolean; loadingMore?: boolean }
interface Answer { q: string; groups: GroupResult[]; best: Hit | null }

const GROUP_META: Record<GroupId, { title: string; icon: typeof Users }> = {
  customers: { title: "Customers", icon: Users },
  suppliers: { title: "Suppliers", icon: Building2 },
  products: { title: "Products", icon: Package },
  sales: { title: "Sale bills", icon: ShoppingCart },
  purchases: { title: "Purchase bills", icon: Truck },
  payments: { title: "Payments and vouchers", icon: Wallet },
};
const TONE: Record<string, string> = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};
const RECENT_KEY = "crm-recent-searches";
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 6); } catch { return []; } };
const saveRecent = (q: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6))); } catch { /* private window */ } };

/** The matched words in bold. */
function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.split(/\s+/).filter((w) => w.length > 0).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
const PAGES = SHORTCUT_ACTIONS.filter((a) => a.href.startsWith("/"));

export default function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  // The page the window was opened on: it shows only while you are still there (going to a result closes it)
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);
  const setOpen = useCallback((v: boolean) => setOpenedOn(v ? pathRef.current : null), []);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, Answer>());
  const lastFocus = useRef<HTMLElement | null>(null);

  // Opened by the header search box or the shortcut (Ctrl+K by default); a second press closes it
  useEffect(() => {
    const toggle = () => setOpenedOn((on) => {
      if (on === pathRef.current) return null;
      lastFocus.current = document.activeElement as HTMLElement | null;
      setRecent(readRecent());
      return pathRef.current;
    });
    window.addEventListener(OPEN_SEARCH, toggle);
    return () => window.removeEventListener(OPEN_SEARCH, toggle);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.select(), 0); else lastFocus.current?.focus?.(); }, [open]);

  const query = q.trim();
  // Search after a short pause in typing; the previous request is cancelled; answers are remembered
  useEffect(() => {
    if (!open || query.length < 2) return;
    const cached = cache.current.get(query.toLowerCase());
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (cached) { setAnswer(cached); setLoading(false); return; }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Search failed");
        cache.current.set(query.toLowerCase(), data);
        if (cache.current.size > 50) cache.current.delete(cache.current.keys().next().value!);
        setAnswer(data);
        setActive(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, cached ? 0 : 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  const pages = useMemo(() => {
    if (!query) return PAGES.slice(0, 6);
    const words = query.toLowerCase().split(/\s+/);
    return PAGES.filter((p) => words.every((w) => p.label.toLowerCase().includes(w))).slice(0, 4);
  }, [query]);
  const shown = query.length >= 2 && answer?.q === query ? answer : null;
  const groups = (shown?.groups ?? []).filter((g) => g.hits.length > 0);

  // One flat list for the arrow keys: best match, results, "Show more" buttons, then pages
  type Item = { key: string; kind: "hit"; hit: Hit } | { key: string; kind: "more"; group: GroupId } | { key: string; kind: "page"; href: string; label: string } | { key: string; kind: "recent"; text: string };
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (!query) recent.forEach((r) => out.push({ key: `r:${r}`, kind: "recent", text: r }));
    if (shown?.best) out.push({ key: `best:${shown.best.group}:${shown.best.id}`, kind: "hit", hit: shown.best });
    for (const g of groups) {
      for (const h of g.hits) if (!(shown?.best && h.id === shown.best.id && h.group === shown.best.group)) out.push({ key: `${g.group}:${h.id}`, kind: "hit", hit: h });
      if (g.hasMore) out.push({ key: `more:${g.group}`, kind: "more", group: g.group });
    }
    pages.forEach((p) => out.push({ key: `p:${p.id}`, kind: "page", href: p.href, label: p.label }));
    return out;
  }, [query, recent, shown, groups, pages]);
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  const go = useCallback((href: string) => {
    if (query.length >= 2) saveRecent(query);
    setOpen(false);
    router.push(href);
  }, [query, router, setOpen]);

  const showMore = useCallback(async (group: GroupId) => {
    if (!answer) return;
    const g = answer.groups.find((x) => x.group === group);
    if (!g || g.loadingMore) return;
    const mark = (patch: Partial<GroupResult>) => setAnswer((a) => a && { ...a, groups: a.groups.map((x) => (x.group === group ? { ...x, ...patch } : x)) });
    mark({ loadingMore: true });
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(answer.q)}&group=${group}&skip=${g.hits.length}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setAnswer((a) => {
        if (!a) return a;
        const next = { ...a, groups: a.groups.map((x) => (x.group === group ? { ...x, hits: [...x.hits, ...data.hits], hasMore: data.hasMore, loadingMore: false } : x)) };
        cache.current.set(a.q.toLowerCase(), next);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
      mark({ loadingMore: false });
    }
  }, [answer]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "hit") go(item.hit.href);
    else if (item.kind === "page") go(item.href);
    else if (item.kind === "more") void showMore(item.group);
    else { setQ(item.text); setActive(0); }
  };

  // Keep the highlighted row in view
  useEffect(() => { list.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  if (!open) return null;
  const position = new Map(items.map((it, n) => [it.key, n]));
  const row = (item: Item, content: React.ReactNode, extraClass = "") => {
    const i = position.get(item.key) ?? -1;
    return (
      <button key={item.key} type="button" data-index={i} role="option" aria-selected={i === activeIndex}
        onMouseMove={() => setActive(i)} onClick={() => choose(item)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${i === activeIndex ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"} ${extraClass}`}>
        {content}
      </button>
    );
  };
  const hitContent = (h: Hit, best = false) => {
    const Icon = GROUP_META[h.group].icon;
    return (
      <>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${best ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium"><Highlight text={h.title} q={query} /></span>
          <span className="block truncate text-xs text-muted-foreground">
            {best && <span className="mr-1 font-medium text-primary">{GROUP_META[h.group].title.replace(/s$/, "")} ·</span>}
            <Highlight text={h.subtitle} q={query} />{h.date ? ` · ${shortDate(h.date)}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {h.badges.map((b, i) => <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[b.tone ?? "muted"]}`}>{b.text}</span>)}
          {h.amount && <span className="ml-1 text-sm font-semibold tabular-nums">{h.amount}</span>}
        </span>
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-3 pt-[8vh] backdrop-blur-sm print:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Search everything" className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl animate-in"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(items[activeIndex]); }
        }}>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="Search customers, suppliers, products, bills, payments..." aria-label="Search everything" role="combobox" aria-expanded="true" aria-controls="search-results"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching" />}
          {q && <button type="button" aria-label="Clear" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { setQ(""); input.current?.focus(); }}><X className="h-4 w-4" /></button>}
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">Esc</kbd>
        </div>

        <div ref={list} id="search-results" role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
          {error && <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}</p>}
          {query.length === 1 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Keep typing: at least 2 letters</p>}
          {!query && recent.length > 0 && (
            <section className="mb-2">
              <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent searches</h3>
              {recent.map((r) => row({ key: `r:${r}`, kind: "recent", text: r }, <><Clock className="h-4 w-4 text-muted-foreground" aria-hidden /><span className="flex-1">{r}</span></>))}
            </section>
          )}
          {shown?.best && (
            <section className="mb-2">
              <h3 className="flex items-center gap-1 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-primary"><Sparkles className="h-3.5 w-3.5" aria-hidden />Best match</h3>
              {row({ key: `best:${shown.best.group}:${shown.best.id}`, kind: "hit", hit: shown.best }, <>{hitContent(shown.best, true)}<CornerDownLeft className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /></>, "bg-primary/5")}
            </section>
          )}
          {groups.map((g) => {
            const Icon = GROUP_META[g.group].icon;
            const hits = g.hits.filter((h) => !(shown?.best && h.id === shown.best.id && h.group === shown.best.group));
            if (!hits.length && !g.hasMore) return null;
            return (
              <section key={g.group} className="mb-2">
                <h3 className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden />{GROUP_META[g.group].title}</h3>
                {hits.map((h) => row({ key: `${g.group}:${h.id}`, kind: "hit", hit: h }, hitContent(h)))}
                {g.hasMore && row({ key: `more:${g.group}`, kind: "more", group: g.group },
                  <span className="flex flex-1 items-center gap-2 pl-12 text-xs font-medium text-primary">{g.loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArrowRight className="h-3.5 w-3.5" aria-hidden />}Show more {GROUP_META[g.group].title.toLowerCase()}</span>)}
              </section>
            );
          })}
          {query.length >= 2 && shown && groups.length === 0 && pages.length === 0 && (
            <div className="px-3 py-10 text-center">
              <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden />
              <p className="text-sm font-medium">Nothing found for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-muted-foreground">Try part of a name, a phone number, a bill number or the supplier&apos;s bill number.</p>
            </div>
          )}
          {pages.length > 0 && (
            <section className="mb-1">
              <h3 className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Receipt className="h-3.5 w-3.5" aria-hidden />{query ? "Pages" : "Go to"}</h3>
              {pages.map((p) => row({ key: `p:${p.id}`, kind: "page", href: p.href, label: p.label }, <><ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden /><span className="flex-1"><Highlight text={p.label} q={query} /></span></>))}
            </section>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border bg-background px-1">↑</kbd> <kbd className="rounded border bg-background px-1">↓</kbd> move</span>
          <span><kbd className="rounded border bg-background px-1">Enter</kbd> open</span>
          <span><kbd className="rounded border bg-background px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
