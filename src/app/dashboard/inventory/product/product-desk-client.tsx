"use client";
// Add New Product (Report 32 B.4): the old screen's order and workflow over the new rules. The screen opens on the
// list; a row shows that product (locked); New clears the form and the number comes on save; Edit unlocks; ✓ saves,
// ✗ cancels. Enter moves Category → Name → X → Y → Gm → packets → loose → purchase rate → sale rate → ✓.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Check, Pencil, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Group { id: string; name: string; ratePerKg: number | null }
interface Product {
  id: string; itemNo: number | null; name: string; categoryId: string; category: string | null; kind: string;
  packCode: string | null; packSize: number | null; dimensionX: number | null; dimensionY: number | null; gsm: number | null; divisor: number;
  purchaseRatePerKg: number | null; saleRatePerKg: number | null; purchasePrice: number; salePrice: number;
  stock: number; stockPacks: number | null; stockLoose: number | null; reorderLevel: number; locked: boolean; baseUnit: string;
}
type Mode = "view" | "new" | "edit";
interface Form {
  categoryId: string; name: string; kind: string; packSize: string; packCode: string;
  x: string; y: string; gsm: string; divisor: string; purchaseRate: string; saleRate: string;
  purchasePrice: string; salePrice: string; openingPackets: string; openingLoose: string; reorderLevel: string; correctionReason: string;
}

const KINDS = [
  { value: "PAPER", label: "Paper (packet of sheets)" },
  { value: "PIECE", label: "Piece (box, carton…)" },
  { value: "WEIGHT", label: "Weight (kg)" },
  { value: "SERVICE", label: "Service (Labour)" },
];
const blank = (groups: Group[]): Form => ({
  categoryId: groups[0]?.id ?? "", name: "", kind: "PAPER", packSize: "100", packCode: "carton",
  x: "", y: "", gsm: "", divisor: "15500", purchaseRate: groups[0]?.ratePerKg ? String(groups[0].ratePerKg) : "", saleRate: "",
  purchasePrice: "", salePrice: "", openingPackets: "0", openingLoose: "0", reorderLevel: "0", correctionReason: "",
});
const fromProduct = (p: Product): Form => ({
  categoryId: p.categoryId, name: p.name, kind: p.kind, packSize: String(p.packSize ?? (p.kind === "PAPER" ? 100 : 1)), packCode: p.packCode ?? "carton",
  x: p.dimensionX ? String(p.dimensionX) : "", y: p.dimensionY ? String(p.dimensionY) : "", gsm: p.gsm ? String(p.gsm) : "", divisor: String(p.divisor || 15500),
  purchaseRate: p.purchaseRatePerKg ? String(p.purchaseRatePerKg) : "", saleRate: p.saleRatePerKg ? String(p.saleRatePerKg) : "",
  purchasePrice: p.purchasePrice ? String(p.purchasePrice) : "", salePrice: p.salePrice ? String(p.salePrice) : "",
  openingPackets: "0", openingLoose: "0", reorderLevel: String(p.reorderLevel ?? 0), correctionReason: "",
});
const num = (t: string) => (Number.isFinite(Number(t)) ? Number(t) : 0);
const fmt = (n: number, dp = 4) => n.toLocaleString("en-PK", { maximumFractionDigits: dp });
const decimal = (t: string) => t.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const whole = (t: string) => t.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export default function ProductDeskClient({ groups, canWrite, isAdmin, startId, startNew }: { groups: Group[]; canWrite: boolean; isAdmin: boolean; startId: string | null; startNew: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Product | null>(null);
  const [mode, setMode] = useState<Mode>(startNew && canWrite ? "new" : "view");
  const [form, setForm] = useState<Form>(() => blank(groups));
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLSelectElement>(null);

  const load = useCallback(async (q: string, pickId?: string | null) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load products");
      setProducts(d.products);
      if (pickId) {
        const hit = (d.products as Product[]).find((p) => p.id === pickId);
        if (hit) { setSelected(hit); setForm(fromProduct(hit)); }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  // The list follows the search box (number or name), a short moment after typing stops
  const startPick = useRef(startId);
  useEffect(() => {
    const t = setTimeout(() => { load(query, startPick.current); startPick.current = null; }, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const editing = mode !== "view";
  const paper = form.kind === "PAPER";
  const packSize = Math.max(1, Math.round(num(form.packSize) || 1));
  // Kg of one packet = X × Y × gm ÷ D (kg of 100 sheets), scaled to the packet's sheets; prices per packet = kg × rate
  const kg = useMemo(() => {
    const [x, y, g, d] = [num(form.x), num(form.y), num(form.gsm), num(form.divisor) || 15500];
    return x > 0 && y > 0 && g > 0 ? ((x * y * g) / d) * (packSize / 100) : null;
  }, [form.x, form.y, form.gsm, form.divisor, packSize]);
  const pPrice = kg !== null && num(form.purchaseRate) > 0 ? Math.round(kg * num(form.purchaseRate) * 10000) / 10000 : null;
  const sPrice = kg !== null && num(form.saleRate) > 0 ? Math.round(kg * num(form.saleRate) * 10000) / 10000 : null;
  const openingTotal = num(form.openingPackets) * (paper || form.kind === "PIECE" ? packSize : 1) + num(form.openingLoose);
  const unitsLocked = mode === "edit" && !!selected?.locked;
  const packChanged = mode === "edit" && !!selected && (form.kind !== selected.kind || (selected.packSize !== null && packSize !== selected.packSize));
  const needsReason = unitsLocked && packChanged;

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const startNewForm = () => {
    if (!canWrite) return;
    setSelected(null); setForm(blank(groups)); setMode("new");
    setTimeout(() => first.current?.focus(), 0);
  };
  const startEdit = () => {
    if (!canWrite || !selected) return;
    setForm(fromProduct(selected)); setMode("edit");
    setTimeout(() => first.current?.focus(), 0);
  };
  const cancel = () => {
    setMode("view");
    setForm(selected ? fromProduct(selected) : blank(groups));
  };
  const show = (p: Product) => {
    if (editing) return; // finish or cancel the open entry first, as on the old screen
    setSelected(p); setForm(fromProduct(p));
  };
  useEffect(() => {
    if (startNew && canWrite) setTimeout(() => first.current?.focus(), 0);
  }, [startNew, canWrite]);

  const save = useCallback(async () => {
    if (!editing || saving) return;
    if (!form.name.trim()) { toast.error("Enter the product name"); return; }
    if (needsReason && form.correctionReason.trim().length < 10) { toast.error("Stock has moved: give a reason of at least 10 characters for changing the packet size"); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(), categoryId: form.categoryId, kind: form.kind,
        packSize: paper || form.kind === "PIECE" ? packSize : undefined, packCode: form.kind === "PIECE" ? form.packCode : undefined,
        dimensionX: paper ? num(form.x) || null : null, dimensionY: paper ? num(form.y) || null : null, gsm: paper ? num(form.gsm) || null : null,
        divisor: paper ? num(form.divisor) || 15500 : null,
        purchaseRatePerKg: paper ? num(form.purchaseRate) || null : null, saleRatePerKg: paper ? num(form.saleRate) || null : null,
        purchasePrice: paper ? null : num(form.purchasePrice) || null, salePrice: paper ? null : num(form.salePrice) || null,
        openingPackets: mode === "new" ? num(form.openingPackets) : undefined, openingLoose: mode === "new" ? num(form.openingLoose) : undefined,
        reorderLevel: num(form.reorderLevel), correctionReason: needsReason ? form.correctionReason.trim() : undefined,
      };
      const r = await fetch(mode === "new" ? "/api/products" : `/api/products/${selected!.id}`, {
        method: mode === "new" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Not saved");
      const saved = d.product as Product;
      toast.success(mode === "new" ? `Saved: product number ${saved.itemNo}` : "Changes saved");
      setMode("view"); setSelected(saved); setForm(fromProduct(saved));
      await load(query, saved.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editing, saving, form, needsReason, paper, packSize, mode, selected, load, query]);

  // Ctrl+S saves; Esc cancels an open entry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
      else if (e.key === "Escape" && editing) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Enter moves to the next box of the old order (skipping boxes that are hidden or locked)
  const formRef = useRef<HTMLDivElement>(null);
  const onEnter = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const boxes = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-step]:not([disabled])") ?? []);
    const i = boxes.indexOf(e.currentTarget);
    (boxes[i + 1] ?? document.getElementById("product-save"))?.focus();
  };

  // Locked (viewing) boxes keep full contrast: the product must be readable, not faded
  const field = "h-9 disabled:cursor-default disabled:opacity-100";
  const label = "text-sm font-medium";
  const readOnly = !editing;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/inventory" aria-label="Back to inventory"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-bold">Add New Product</h1>
        </div>
        <p className="text-sm text-muted-foreground">Enter moves to the next box · Ctrl+S saves · Esc cancels</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ── Form ── */}
        <div ref={formRef} className="space-y-4 rounded-xl border bg-card p-4">
          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product info</legend>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
              <span className={label}>Product No.</span>
              <span className="inline-flex h-9 w-28 items-center rounded-md bg-amber-300 px-3 font-bold text-amber-950 tabular-nums" aria-live="polite">
                {mode === "new" ? "new" : selected?.itemNo ?? "—"}
              </span>
              <label htmlFor="p-cat" className={label}>Category</label>
              <select id="p-cat" ref={first} data-step disabled={readOnly} value={form.categoryId} onKeyDown={onEnter}
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-default disabled:opacity-100"
                onChange={(e) => {
                  // As on the old screen, choosing a group fills the purchase rate with the group's price
                  const g = groups.find((x) => x.id === e.target.value);
                  set({ categoryId: e.target.value, ...(g?.ratePerKg ? { purchaseRate: String(g.ratePerKg) } : {}) });
                }}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.ratePerKg ? ` (Rs ${g.ratePerKg}/kg)` : ""}</option>)}
              </select>
              <label htmlFor="p-name" className={label}>Product Name</label>
              <Input id="p-name" data-step className={field} disabled={readOnly} value={form.name} onKeyDown={onEnter} onChange={(e) => set({ name: e.target.value })} />
              <label htmlFor="p-kind" className={label}>Kind</label>
              <select id="p-kind" disabled={readOnly || unitsLocked && !isAdmin} value={form.kind} onChange={(e) => set({ kind: e.target.value, packSize: e.target.value === "PAPER" ? "100" : "1" })}
                className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-default disabled:opacity-100">
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
          </fieldset>

          {paper && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Size</legend>
              <div className="grid grid-cols-4 gap-2">
                {([["x", "X"], ["y", "Y"], ["gsm", "Gm"], ["divisor", "D"]] as const).map(([k, l]) => (
                  <label key={k} className="space-y-1 text-sm">
                    <span className="font-medium">{l}</span>
                    <Input data-step={k === "divisor" ? undefined : true} className={field} inputMode="decimal" disabled={readOnly} value={form[k]}
                      onKeyDown={onEnter} onFocus={(e) => e.target.select()} onChange={(e) => set({ [k]: decimal(e.target.value) } as Partial<Form>)} />
                  </label>
                ))}
              </div>
              <p className="text-sm">Kg per packet: <strong className="tabular-nums">{kg !== null ? fmt(kg) : "—"}</strong></p>
            </fieldset>
          )}

          {form.kind !== "SERVICE" && form.kind !== "WEIGHT" && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packet and opening stock</legend>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
                <label htmlFor="p-pack" className={label}>{paper ? "Sheets in a packet" : "Pieces in a pack"}</label>
                <Input id="p-pack" className={field} inputMode="numeric" value={form.packSize}
                  disabled={readOnly || (unitsLocked && !isAdmin)} onChange={(e) => set({ packSize: whole(e.target.value) })} />
                {!paper && (<>
                  <label htmlFor="p-packcode" className={label}>Pack name</label>
                  <Input id="p-packcode" className={field} disabled={readOnly || unitsLocked} value={form.packCode} onChange={(e) => set({ packCode: e.target.value })} />
                </>)}
                {mode === "new" && (<>
                  <label htmlFor="p-op" className={label}>Opening {paper ? "packets" : "packs"}</label>
                  <Input id="p-op" data-step className={field} inputMode="numeric" value={form.openingPackets} onKeyDown={onEnter}
                    onFocus={(e) => e.target.select()} onChange={(e) => set({ openingPackets: whole(e.target.value) })} />
                  <label htmlFor="p-ol" className={label}>Opening loose {paper ? "sheets" : "pieces"}</label>
                  <Input id="p-ol" data-step className={field} inputMode="numeric" value={form.openingLoose} onKeyDown={onEnter}
                    onFocus={(e) => e.target.select()} onChange={(e) => set({ openingLoose: whole(e.target.value) })} />
                  <span className={label}>Total opening stock</span>
                  <span className="tabular-nums">{fmt(openingTotal, 0)} {paper ? "sheets" : "pieces"}</span>
                </>)}
              </div>
              {unitsLocked && <p className="text-xs text-muted-foreground">Stock of this product has moved, so its packet size is locked{isAdmin ? "; an administrator may correct it with a reason" : ""}.</p>}
              {needsReason && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Reason for correcting the packet size (kept in the history)</span>
                  <Input className={field} value={form.correctionReason} onChange={(e) => set({ correctionReason: e.target.value })} />
                </label>
              )}
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prices</legend>
            {paper ? (
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-2 text-sm">
                <span />
                <span className="text-xs text-muted-foreground">Rate per kg</span>
                <span className="text-xs text-muted-foreground">Per packet</span>
                <label htmlFor="p-pr" className={label}>Purchase (Sup-Price)</label>
                <Input id="p-pr" data-step className={field} inputMode="decimal" disabled={readOnly} value={form.purchaseRate} onKeyDown={onEnter}
                  onFocus={(e) => e.target.select()} onChange={(e) => set({ purchaseRate: decimal(e.target.value) })} />
                <span className="tabular-nums">{pPrice !== null ? fmt(pPrice) : "—"}</span>
                <label htmlFor="p-sr" className={label}>Sale (Sale Price)</label>
                <Input id="p-sr" data-step className={field} inputMode="decimal" disabled={readOnly} value={form.saleRate} onKeyDown={onEnter}
                  onFocus={(e) => e.target.select()} onChange={(e) => set({ saleRate: decimal(e.target.value) })} />
                <span className="tabular-nums">{sPrice !== null ? fmt(sPrice) : "—"}</span>
              </div>
            ) : form.kind !== "SERVICE" ? (
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2">
                <label htmlFor="p-pp" className={label}>Purchase price {form.kind === "WEIGHT" ? "per kg" : packSize > 1 ? `per ${form.packCode}` : "each"}</label>
                <Input id="p-pp" data-step className={field} inputMode="decimal" disabled={readOnly} value={form.purchasePrice} onKeyDown={onEnter}
                  onFocus={(e) => e.target.select()} onChange={(e) => set({ purchasePrice: decimal(e.target.value) })} />
                <label htmlFor="p-sp" className={label}>Sale price {form.kind === "WEIGHT" ? "per kg" : packSize > 1 ? `per ${form.packCode}` : "each"}</label>
                <Input id="p-sp" data-step className={field} inputMode="decimal" disabled={readOnly} value={form.salePrice} onKeyDown={onEnter}
                  onFocus={(e) => e.target.select()} onChange={(e) => set({ salePrice: decimal(e.target.value) })} />
              </div>
            ) : <p className="text-sm text-muted-foreground">A service holds no stock; its price is typed on each bill.</p>}
            {form.kind !== "SERVICE" && (
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
                <label htmlFor="p-ro" className={label}>Low-stock alert at ({paper ? "packets" : form.kind === "WEIGHT" ? "kg" : packSize > 1 ? `${form.packCode}s` : "pieces"})</label>
                <Input id="p-ro" className={field} inputMode="numeric" disabled={readOnly} value={form.reorderLevel} onFocus={(e) => e.target.select()} onChange={(e) => set({ reorderLevel: whole(e.target.value) })} />
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            {editing ? (<>
              <Button id="product-save" onClick={() => void save()} disabled={saving} aria-label="Save (Ctrl+S)" className="min-w-24">
                <Check className="mr-1 h-4 w-4" aria-hidden /> {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" onClick={cancel} disabled={saving} aria-label="Cancel (Esc)"><X className="mr-1 h-4 w-4" aria-hidden /> Cancel</Button>
            </>) : (<>
              <Button onClick={startNewForm} disabled={!canWrite}><Plus className="mr-1 h-4 w-4" aria-hidden /> New</Button>
              <Button variant="outline" onClick={startEdit} disabled={!canWrite || !selected}><Pencil className="mr-1 h-4 w-4" aria-hidden /> Edit</Button>
            </>)}
          </div>
        </div>

        {/* ── Product list ── */}
        <div className="min-w-0 space-y-2 rounded-xl border bg-card p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Find product by number or name" className="pl-9" placeholder="Find: product number or name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="relative max-h-[70vh] overflow-auto rounded-lg border">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  {["No.", "Item Name", "X", "Y", "gm", "DV", "Sup-Price", "S-Price", "Category", "Packet", "Stock"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-1.5 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading && !products.length ? (
                  <tr><td colSpan={11} className="px-2 py-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : !products.length ? (
                  <tr><td colSpan={11} className="px-2 py-6 text-center text-muted-foreground">No products{query ? ` match "${query}"` : " yet"}</td></tr>
                ) : products.map((p) => (
                  <tr key={p.id} tabIndex={0} aria-selected={selected?.id === p.id}
                    className={cn("cursor-pointer border-t outline-none focus-visible:bg-muted", selected?.id === p.id ? "bg-primary/10 font-medium" : "hover:bg-muted/60")}
                    onClick={() => show(p)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(p); } }}>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.itemNo ?? "—"}</td>
                    <td className="px-1.5 py-1.5">{p.name}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.dimensionX ?? ""}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.dimensionY ?? ""}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.gsm ?? ""}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.kind === "PAPER" ? p.divisor : ""}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.kind === "PAPER" ? p.purchaseRatePerKg ?? 0 : p.purchasePrice}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.kind === "PAPER" ? p.saleRatePerKg ?? 0 : p.salePrice}</td>
                    <td className="px-1.5 py-1.5">{p.category}</td>
                    <td className="px-1.5 py-1.5 tabular-nums">{p.packSize ? `${p.packSize} ${p.baseUnit}s` : p.baseUnit}</td>
                    <td className="px-1.5 py-1.5 tabular-nums whitespace-nowrap">
                      {p.kind === "SERVICE" ? "—" : p.stockPacks !== null ? `${p.stockPacks} ${p.packCode}${p.stockLoose ? ` + ${p.stockLoose}` : ""}` : `${p.stock} ${p.baseUnit}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Sup-Price and S-Price are rates per kg for paper, prices per pack for other products.</p>
        </div>
      </div>
    </div>
  );
}
