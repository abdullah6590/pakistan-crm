"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Package, Plus, RotateCcw, Scale, Search, Trash2, Truck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPaisa } from "@/lib/utils";
import { specLabel, type ProductSpec } from "@/lib/product-spec";

export interface ItemOption extends ProductSpec {
  id: string; name: string; sku: string; quantity: number;
  baseUnit?: string; purchaseUnit?: string; units?: { code: string; factor: number }[];
}
export interface SupplierOption { id: string; name: string; phone: string | null }
/** Paper bought by weight, as on the old Supplier Invoice: size, GSM, divisor and rate per kg (all as typed). */
interface Paper { x: string; y: string; gsm: string; divisor: string; rate: string }
interface Line {
  componentId: string; name: string; sku: string; item: ItemOption; quantity: string; unit: string; loose: string; price: string;
  paper: Paper | null;
  /** The price was typed over the calculated one */
  priceTyped: boolean;
}
interface Charge { kind: string; amount: string; description: string }

export interface EditPurchase {
  id: string; docNo: string; date: string; supplier: SupplierOption;
  vendorBillNo: string | null; vendorBillDate: string | null; dueDate: string | null; biltyNo: string | null; biltyDate: string | null; notes: string | null;
  lines: {
    quantity: string; unit: string; loose: string; unitPrice: string; item: ItemOption;
    paperX: string | null; paperY: string | null; paperGsm: string | null; paperDivisor: string | null; ratePerKg: string | null;
  }[];
}

const CHARGE_LABEL: Record<string, string> = { FREIGHT: "Freight", LOADING: "Loading", BILTY: "Bilty", OTHER_PURCHASE: "Other purchase charge" };
const today = () => new Date().toISOString().slice(0, 10);
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");
const decimal = (t: string, dp = 2) => {
  const [w, ...rest] = t.replace(/[^\d.]/g, "").split(".");
  const whole = w.replace(/^0+(?=\d)/, "");
  return rest.length ? `${whole || "0"}.${rest.join("").slice(0, dp)}` : whole;
};
const factorOf = (l: Pick<Line, "item" | "unit">) => l.item.units?.find((u) => u.code === l.unit)?.factor ?? 1;
const isPack = (l: Pick<Line, "item" | "unit">) => !!l.item.baseUnit && l.unit !== l.item.baseUnit;
/** Sheets (stock units) in one unit of the line: 100 for a rim of 100, 1 for a sheet. */
const sheetsPer = (l: Pick<Line, "item" | "unit">) => factorOf(l);
/** Paper from the product: offered when it has a size and GSM. */
const paperFromItem = (it: ItemOption): Paper | null =>
  it.dimensionX && it.dimensionY && it.gsm
    ? { x: String(it.dimensionX), y: String(it.dimensionY), gsm: String(it.gsm), divisor: String(it.divisor || 15500), rate: it.ratePerKg ? String(it.ratePerKg) : "" }
    : null;
/** Kg of 100 sheets = X x Y x GSM / divisor (old "Kg"); null until the size is complete. */
const kgPer100 = (p: Paper | null) => {
  if (!p) return null;
  const [x, y, g, d] = [p.x, p.y, p.gsm, p.divisor || "15500"].map(Number);
  return x > 0 && y > 0 && g > 0 && d > 0 ? (x * y * g) / d : null;
};
/** Kg of one unit of the line: a rim of 100 sheets weighs the "Kg", a ream of 500 five times that (OD-02). */
const kgPerUnit = (l: Pick<Line, "item" | "unit" | "paper">) => {
  const k = kgPer100(l.paper);
  return k === null ? null : (k * sheetsPer(l)) / 100;
};
/** Price of one unit from the weight and the rate per kg (old "P-Price"), kept to 4 decimals like the old screen. */
const calculatedPrice = (l: Pick<Line, "item" | "unit" | "paper">) => {
  const kg = kgPerUnit(l);
  const rate = Number(l.paper?.rate);
  return kg !== null && rate > 0 ? String(Math.round(kg * rate * 10000) / 10000) : null;
};
const totalSheets = (l: Line) => (Number(l.quantity) || 0) * sheetsPer(l) + (isPack(l) ? Number(l.loose) || 0 : 0);
const fmt = (n: number, dp = 2) => n.toLocaleString("en-PK", { maximumFractionDigits: dp });

/** As Books prices it: whole units at their price, loose stock units at the price divided by the pack size; paisa kept. */
const lineAmount = (l: Line) => {
  const q = Number(l.quantity) || 0;
  const p = Number(l.price) || 0;
  const loose = isPack(l) ? Number(l.loose) || 0 : 0;
  return Math.round((p * q + (loose ? (p / factorOf(l)) * loose : 0)) * 100) / 100;
};

export default function NewPurchaseClient({ suppliers: initialSuppliers, initialItems, methods, canPay, editing, initialSupplier }: {
  suppliers: SupplierOption[]; initialItems: ItemOption[]; methods: { value: string; label: string }[]; canPay: boolean; editing?: EditPurchase; initialSupplier?: SupplierOption | null;
}) {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [supplier, setSupplier] = useState<SupplierOption | null>(editing?.supplier ?? initialSupplier ?? null);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [date, setDate] = useState(day(editing?.date) || today());
  const [vendorBillNo, setVendorBillNo] = useState(editing?.vendorBillNo ?? "");
  const [vendorBillDate, setVendorBillDate] = useState(day(editing?.vendorBillDate));
  const [dueDate, setDueDate] = useState(day(editing?.dueDate));
  const [biltyNo, setBiltyNo] = useState(editing?.biltyNo ?? "");
  const [biltyDate, setBiltyDate] = useState(day(editing?.biltyDate));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (editing?.lines ?? []).map((l) => ({
    componentId: l.item.id, name: l.item.name, sku: l.item.sku, item: l.item, quantity: String(Number(l.quantity)), unit: l.unit, loose: Number(l.loose) ? String(Number(l.loose)) : "", price: String(Number(l.unitPrice)),
    paper: l.paperX && l.paperY && l.paperGsm ? { x: l.paperX, y: l.paperY, gsm: l.paperGsm, divisor: l.paperDivisor ?? "15500", rate: l.ratePerKg ?? "" } : null,
    priceTyped: true,
  })));
  const [charges, setCharges] = useState<Charge[]>([]);
  const [paid, setPaid] = useState({ amount: "", method: "CASH", reference: "" });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());

  // Item search: the most used items until two letters are typed, then the server's matches for what was typed
  const [itemQuery, setItemQuery] = useState("");
  const [found, setFound] = useState<{ q: string; items: ItemOption[] } | null>(null);
  const q = itemQuery.trim();
  const items = q.length === 0 ? initialItems : q.length < 2 ? [] : found?.q === q ? found.items : [];
  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/components?q=${encodeURIComponent(q)}&limit=10`, { signal: controller.signal });
        const data = await res.json();
        setFound({ q, items: res.ok ? data.data : [] });
      } catch { /* a newer search replaced this one */ }
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [q]);

  // New supplier from this screen (with the same duplicate check as the Suppliers page)
  const [newSupplier, setNewSupplier] = useState<null | { name: string; phone: string; contactPerson: string; why: string; duplicates: { name: string }[] }>(null);
  const createSupplier = async () => {
    if (!newSupplier?.name.trim()) { toast.error("Enter the supplier's name"); return; }
    const res = await fetch("/api/suppliers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSupplier.name, phone: newSupplier.phone || null, contactPerson: newSupplier.contactPerson || null, confirmNotDuplicate: newSupplier.why || undefined }),
    });
    const data = await res.json();
    if (res.status === 409 && data.details?.duplicates) { setNewSupplier({ ...newSupplier, duplicates: data.details.duplicates }); toast.error(data.error); return; }
    if (!res.ok) { toast.error(data.error || "Could not add the supplier"); return; }
    const s = { id: data.supplier.id, name: data.supplier.name, phone: data.supplier.phone };
    setSuppliers([s, ...suppliers]);
    setSupplier(s);
    setNewSupplier(null);
    toast.success(`${s.name} added`);
  };

  const supplierMatches = supplierQuery.trim() ? suppliers.filter((s) => `${s.name} ${s.phone ?? ""}`.toLowerCase().includes(supplierQuery.trim().toLowerCase())).slice(0, 8) : [];
  const total = useMemo(() => Math.round(lines.reduce((t, l) => t + lineAmount(l), 0) * 100) / 100, [lines]);
  const paidNow = Number(paid.amount) || 0;
  const paperLines = lines.filter((l) => l.paper);
  const weight = paperLines.reduce((t, l) => t + ((kgPer100(l.paper) ?? 0) * totalSheets(l)) / 100, 0);
  const sheetsTotal = paperLines.reduce((t, l) => t + totalSheets(l), 0);
  const unitsTotal = Object.entries(lines.reduce<Record<string, number>>((t, l) => (isPack(l) ? { ...t, [l.unit]: (t[l.unit] ?? 0) + (Number(l.quantity) || 0) } : t), {}));

  // The supplier's balance, as on the old screen (what you owe them before this bill)
  const [balance, setBalance] = useState<{ id: string; balance: number } | null>(null);
  useEffect(() => {
    if (!supplier) return;
    const controller = new AbortController();
    fetch(`/api/suppliers/${supplier.id}?summary=1`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setBalance({ id: supplier.id, balance: Number(data.balance) }); })
      .catch(() => { /* changed supplier or offline: no balance shown */ });
    return () => controller.abort();
  }, [supplier]);

  /** Changes a line; while the price has not been typed over, it follows size, GSM, rate per kg and unit. */
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    if (!next.priceTyped) next.price = calculatedPrice(next) ?? next.price;
    return next;
  }));
  const setPaper = (i: number, patch: Partial<Paper>) => setLine(i, { paper: { ...(lines[i].paper ?? { x: "", y: "", gsm: "", divisor: "15500", rate: "" }), ...patch } });
  const add = (item: ItemOption) => {
    setItemQuery("");
    if (lines.some((l) => l.componentId === item.id)) { toast.info(`${item.name} is already on the bill`); return; }
    const line: Line = { componentId: item.id, name: item.name, sku: item.sku, item, quantity: "1", unit: item.purchaseUnit ?? item.baseUnit ?? "", loose: "", price: "", paper: paperFromItem(item), priceTyped: false };
    line.price = calculatedPrice(line) ?? "";
    setLines([...lines, line]);
  };

  const problem = (() => {
    if (!supplier) return "Choose the supplier";
    if (!lines.length) return "Add at least one item";
    for (const l of lines) {
      if (!(Number(l.quantity) > 0) && !(isPack(l) && Number(l.loose) > 0)) return `${l.name}: enter the quantity`;
      if (!(Number(l.price) > 0)) return `${l.name}: enter the purchase price`;
      if (isPack(l) && Number(l.loose) >= factorOf(l)) return `${l.name}: loose ${l.item.baseUnit} must be fewer than one ${l.unit}`;
      if (l.paper && kgPer100(l.paper) === null) return `${l.name}: fill in X, Y and GSM, or remove the weight details`;
    }
    if (dueDate && dueDate < date) return "The due date cannot be before the bill date";
    if (paidNow > total) return "Paid now is more than the bill total; pay the extra as an advance from Pay supplier";
    for (const c of charges) if (!(Number(c.amount) > 0) || !c.description.trim()) return "Each charge needs an amount and a description";
    if (editing && reason.trim().length < 3) return "Give a reason for the change";
    return null;
  })();

  const submit = async () => {
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      const body = {
        date, supplierId: supplier!.id, vendorBillNo: vendorBillNo.trim() || null, vendorBillDate: vendorBillDate || null, dueDate: dueDate || null,
        biltyNo: biltyNo.trim() || null, biltyDate: biltyDate || null, notes: notes.trim() || null,
        items: lines.map((l) => ({
          componentId: l.componentId, quantity: l.quantity || "0", unit: l.unit || undefined, loose: isPack(l) && Number(l.loose) > 0 ? l.loose : undefined, unitPrice: l.price,
          paper: l.paper ? { x: l.paper.x, y: l.paper.y, gsm: l.paper.gsm, divisor: l.paper.divisor || null, ratePerKg: l.paper.rate || null } : undefined,
        })),
        ...(editing ? { reason: reason.trim() } : {
          requestId,
          charges: charges.map((c) => ({ kind: c.kind, amount: c.amount, description: c.description.trim() })),
          paidNow: paidNow > 0 ? { amount: paid.amount, method: paid.method, reference: paid.reference.trim() || undefined } : null,
        }),
      };
      const res = await fetch(editing ? `/api/purchases/${editing.id}` : "/api/purchases", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the bill");
      // Working from this computer's copy: queued for the main server
      if (data.pending) { toast.success(`Saved on this computer as ${data.entry.provisionalRef ?? "a pending entry"}; it gets its number when it syncs with the main server`, { duration: 10000 }); router.push("/dashboard/purchases"); return; }
      if (editing) {
        toast.success(`Bill saved as ${data.purchase.docNo}`);
        const freed = (data.releasedCredit ?? []).reduce((t: number, c: { amount: string }) => t + Number(c.amount), 0);
        if (freed > 0) toast.info(`${formatPaisa(freed)} already paid no longer fits this bill. It is now the supplier's credit: use it for another bill or record a refund in Pay supplier.`, { duration: 12000 });
      } else {
        toast.success(`Purchase bill ${data.purchase.docNo} saved${data.payment ? `, payment ${data.payment.docNo}` : ""}`);
      }
      router.push(`/dashboard/purchases/${data.purchase.id}`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.back()}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{editing ? `Edit purchase bill ${editing.docNo}` : "New purchase"}</h1>
          <p className="text-sm text-muted-foreground">{editing ? "The bill gets a new revision with the same number; its payments stay with it." : "Stock comes in at these prices and the supplier is owed the total (paisa kept)."}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" aria-hidden /> Supplier and bill</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {supplier ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                  <div><p className="font-medium">{supplier.name}</p>{supplier.phone && <p className="text-xs text-muted-foreground">{supplier.phone}</p>}</div>
                  {balance?.id === supplier.id && (
                    <div className="ml-auto mr-2 text-right">
                      <p className="text-xs text-muted-foreground">Balance before this bill</p>
                      <p className={`text-sm font-semibold tabular-nums ${balance.balance > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                        {balance.balance > 0 ? `You owe ${formatPaisa(balance.balance)}` : balance.balance < 0 ? `Advance ${formatPaisa(-balance.balance)}` : "Nothing owed"}
                      </p>
                    </div>
                  )}
                  {!editing && <Button variant="ghost" size="sm" onClick={() => setSupplier(null)}>Change</Button>}
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input aria-label="Search supplier" className="pl-9" placeholder="Search supplier by name or phone..." value={supplierQuery} onChange={(e) => setSupplierQuery(e.target.value)} />
                  {supplierQuery.trim() && (
                    <div className="absolute z-20 top-full mt-1 w-full rounded-lg border bg-background shadow-lg">
                      {supplierMatches.map((s) => (
                        <button key={s.id} type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setSupplier(s); setSupplierQuery(""); }}>
                          <span className="font-medium">{s.name}</span> {s.phone && <span className="text-muted-foreground">{s.phone}</span>}
                        </button>
                      ))}
                      <button type="button" className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-primary hover:bg-muted" onClick={() => setNewSupplier({ name: supplierQuery.trim(), phone: "", contactPerson: "", why: "", duplicates: [] })}>
                        <UserPlus className="h-4 w-4" aria-hidden /> Add &quot;{supplierQuery.trim()}&quot; as a new supplier
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label htmlFor="p-date">Bill date</Label><Input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="p-vbn">Supplier bill no.</Label><Input id="p-vbn" value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} placeholder="their invoice number" /></div>
                <div className="space-y-1"><Label htmlFor="p-vbd">Supplier bill date</Label><Input id="p-vbd" type="date" value={vendorBillDate} onChange={(e) => setVendorBillDate(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="p-due">Due date (optional)</Label><Input id="p-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="p-bn">Bilty no.</Label><Input id="p-bn" value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="p-bd">Bilty date</Label><Input id="p-bd" type="date" value={biltyDate} onChange={(e) => setBiltyDate(e.target.value)} /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" aria-hidden /> Items</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Search items" className="pl-9" placeholder="Search item by name or SKU..." value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} />
                {itemQuery.trim() && items.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-background shadow-lg">
                    {items.map((it) => (
                      <button key={it.id} type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => add(it)}>
                        <span>
                          <span className="font-medium">{it.name}</span>
                          {specLabel(it) && <span className="ml-2 inline-block whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs">{specLabel(it)}</span>}{" "}
                          <span className="text-xs text-muted-foreground">{it.sku} · in stock {it.quantity} {it.baseUnit ?? ""}</span>
                        </span>
                        <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {lines.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Search above to add items.</p> : (
                <div className="space-y-2">
                  {lines.map((l, i) => {
                    const kg = kgPerUnit(l);
                    const calc = calculatedPrice(l);
                    const sheets = totalSheets(l);
                    const field = (id: string, label: string, input: React.ReactNode, wide = false) => (
                      <div className={`space-y-1 ${wide ? "min-w-[7.5rem]" : "min-w-[4.5rem]"}`}><Label htmlFor={id} className="whitespace-nowrap text-xs">{label}</Label>{input}</div>
                    );
                    const shown = (label: string, value: string, strong = false) => (
                      <div className="min-w-[5rem] space-y-1"><p className="whitespace-nowrap text-xs text-muted-foreground">{label}</p><p className={`flex h-8 items-center tabular-nums ${strong ? "text-sm font-semibold" : "text-sm"}`}>{value}</p></div>
                    );
                    const qty = (
                      <div className="flex items-end gap-1">
                        {field(`q-${i}`, isPack(l) ? `${l.unit}s` : "Qty", <Input id={`q-${i}`} className="h-8 w-20" inputMode="decimal" value={l.quantity} onFocus={(e) => e.target.select()} onChange={(e) => setLine(i, { quantity: decimal(e.target.value, 3) })} />)}
                        {(l.item.units?.length ?? 0) > 1 ? (
                          field(`u-${i}`, "Unit", (
                            <select id={`u-${i}`} className="h-8 rounded-md border border-input bg-background px-1 text-xs" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value, loose: "" })}>
                              {l.item.units!.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                            </select>
                          ))
                        ) : <span className="pb-2 text-xs text-muted-foreground">{l.unit}</span>}
                        {isPack(l) && field(`l-${i}`, `+ loose ${l.item.baseUnit}s`, <Input id={`l-${i}`} className="h-8 w-20" inputMode="decimal" value={l.loose} onChange={(e) => setLine(i, { loose: decimal(e.target.value, 3) })} />)}
                      </div>
                    );
                    const price = field(`p-${i}`, `Price per ${l.unit || "unit"}`, (
                      <div className="flex items-center gap-1">
                        <Input id={`p-${i}`} className="h-8 w-28" inputMode="decimal" value={l.price} placeholder="0.00" onFocus={(e) => e.target.select()} onChange={(e) => setLine(i, { price: decimal(e.target.value, l.paper ? 4 : 2), priceTyped: true })} />
                        {l.paper && l.priceTyped && calc && calc !== l.price && (
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title={`Use the calculated price (Rs ${calc})`} aria-label={`Use the calculated price for ${l.name}`} onClick={() => setLine(i, { priceTyped: false })}><RotateCcw className="h-3.5 w-3.5" aria-hidden /></Button>
                        )}
                      </div>
                    ), true);
                    return (
                      <div key={l.componentId} className="rounded-lg border bg-muted/30 p-3">
                        <div className="mb-2 flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {l.name}
                              {specLabel(l.item) && <span className="ml-2 inline-block whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{specLabel(l.item)}</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">{l.sku}{isPack(l) ? ` · 1 ${l.unit} = ${factorOf(l)} ${l.item.baseUnit}s` : ""}</p>
                          </div>
                          {!l.paper && (
                            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setLine(i, { paper: paperFromItem(l.item) ?? { x: "", y: "", gsm: "", divisor: "15500", rate: "" }, priceTyped: !!l.price })}>
                              <Scale className="mr-1 h-3.5 w-3.5" aria-hidden />Weight &amp; size
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Remove ${l.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                        </div>
                        {l.paper ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-end gap-2 rounded-md bg-background/60 p-2">
                              {field(`x-${i}`, "X (in)", <Input id={`x-${i}`} className="h-8 w-16" inputMode="decimal" value={l.paper.x} onFocus={(e) => e.target.select()} onChange={(e) => setPaper(i, { x: decimal(e.target.value, 3) })} />)}
                              {field(`y-${i}`, "Y (in)", <Input id={`y-${i}`} className="h-8 w-16" inputMode="decimal" value={l.paper.y} onFocus={(e) => e.target.select()} onChange={(e) => setPaper(i, { y: decimal(e.target.value, 3) })} />)}
                              {field(`g-${i}`, "gm (GSM)", <Input id={`g-${i}`} className="h-8 w-16" inputMode="decimal" value={l.paper.gsm} onFocus={(e) => e.target.select()} onChange={(e) => setPaper(i, { gsm: decimal(e.target.value, 2) })} />)}
                              {shown(`Kg per ${l.unit || "unit"}`, kg === null ? "-" : fmt(kg, 4))}
                              {field(`r-${i}`, "Rate per kg (Rs)", <Input id={`r-${i}`} className="h-8 w-24" inputMode="decimal" value={l.paper.rate} placeholder="0.00" onFocus={(e) => e.target.select()} onChange={(e) => setPaper(i, { rate: decimal(e.target.value, 4) })} />, true)}
                              <button type="button" className="ml-auto self-center text-xs text-muted-foreground underline" onClick={() => setLine(i, { paper: null })}>Remove weight details</button>
                            </div>
                            <div className="flex flex-wrap items-end gap-3">
                              {price}
                              {qty}
                              {isPack(l) && shown(`Per ${l.item.baseUnit}`, Number(l.price) > 0 ? `Rs ${fmt(Number(l.price) / sheetsPer(l), 4)}` : "-")}
                              {shown(`Total ${l.item.baseUnit ?? "sheet"}s`, fmt(sheets, 3))}
                              {shown("Weight (kg)", kg === null ? "-" : fmt(((kgPer100(l.paper) ?? 0) * sheets) / 100, 2))}
                              <div className="ml-auto text-right"><p className="text-xs text-muted-foreground">Amount</p><p className="flex h-8 items-center justify-end text-sm font-semibold tabular-nums">{formatPaisa(lineAmount(l))}</p></div>
                            </div>
                            {l.paper && !l.paper.rate && <p className="text-xs text-muted-foreground">Type the rate per kg to work out the price, or type the price per {l.unit || "unit"} directly.</p>}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-end gap-3">
                            {qty}
                            {price}
                            <div className="ml-auto text-right"><p className="text-xs text-muted-foreground">Amount</p><p className="flex h-8 items-center justify-end text-sm font-semibold tabular-nums">{formatPaisa(lineAmount(l))}</p></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {!editing && (
            <Card>
              <CardHeader><CardTitle className="text-base">Freight, loading and bilty</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">Recorded for reference only: not added to the bill total, the supplier&apos;s balance or the item cost. Posting a charge as an expense is a separate step in Books → Charges.</p>
                {charges.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <select aria-label="Charge kind" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={c.kind} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                      {Object.entries(CHARGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <Input aria-label="Charge amount" className="h-9 w-28" inputMode="decimal" placeholder="Rs" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: decimal(e.target.value) } : x)))} />
                    <Input aria-label="Charge description" className="h-9 min-w-[12rem] flex-1" placeholder="e.g. truck from Lahore" value={c.description} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove charge" onClick={() => setCharges(charges.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setCharges([...charges, { kind: "FREIGHT", amount: "", description: "" }])}><Plus className="mr-1 h-4 w-4" aria-hidden /> Add a charge</Button>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Total</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(unitsTotal.length > 0 || paperLines.length > 0) && (
                <dl className="space-y-1 border-b pb-3 text-sm">
                  {unitsTotal.map(([unit, n]) => <div key={unit} className="flex justify-between"><dt className="text-muted-foreground">Total {unit}s</dt><dd className="tabular-nums">{fmt(n, 3)}</dd></div>)}
                  {paperLines.length > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Total sheets</dt><dd className="tabular-nums">{fmt(sheetsTotal, 3)}</dd></div>}
                  {paperLines.length > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Net weight</dt><dd className="font-medium tabular-nums">{fmt(weight, 2)} kg</dd></div>}
                </dl>
              )}
              <div className="flex justify-between text-lg font-bold"><span>Bill total</span><span className="tabular-nums">{formatPaisa(total)}</span></div>
              {!editing && canPay && (
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="paid-now">Paid now (optional)</Label>
                  <Input id="paid-now" inputMode="decimal" placeholder="0 = unpaid" value={paid.amount} onChange={(e) => setPaid({ ...paid, amount: decimal(e.target.value) })} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPaid({ ...paid, amount: "" })}>Nothing</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPaid({ ...paid, amount: String(total) })}>Full</Button>
                  </div>
                  {paidNow > 0 && (<>
                    <Select value={paid.method} onChange={(v: string) => setPaid({ ...paid, method: v })}>
                      <SelectTrigger aria-label="Paid by"><SelectValue /></SelectTrigger>
                      <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input aria-label="Payment reference" placeholder="Bank / cheque reference (optional)" value={paid.reference} onChange={(e) => setPaid({ ...paid, reference: e.target.value })} />
                  </>)}
                  <p className="text-xs text-muted-foreground">Still payable after saving: {formatPaisa(Math.max(0, total - paidNow))}</p>
                </div>
              )}
              {!editing && !canPay && <p className="text-xs text-muted-foreground">The bill is saved unpaid; an administrator or accountant pays the supplier from Pay supplier.</p>}
              <div className="space-y-1"><Label htmlFor="p-notes">Notes</Label><Textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              {editing && <div className="space-y-1"><Label htmlFor="p-reason">Reason for the change *</Label><Input id="p-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. two packets were not delivered" /></div>}
              {problem && lines.length > 0 && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
              <Button className="w-full" disabled={saving} onClick={submit}>{saving ? "Saving..." : editing ? "Save changes" : "Save purchase bill"}</Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!newSupplier} onClose={() => setNewSupplier(null)}>
        <DialogHeader><DialogTitle>New supplier</DialogTitle><DialogDescription>Full details can be added later on the Suppliers page.</DialogDescription></DialogHeader>
        {newSupplier && (
          <div className="space-y-3 text-sm">
            <div className="space-y-1"><Label htmlFor="ns-name">Name *</Label><Input id="ns-name" value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="ns-phone">Phone</Label><Input id="ns-phone" type="tel" value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ns-contact">Contact person</Label><Input id="ns-contact" value={newSupplier.contactPerson} onChange={(e) => setNewSupplier({ ...newSupplier, contactPerson: e.target.value })} /></div>
            </div>
            {newSupplier.duplicates.length > 0 && (
              <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <p>Looks like an existing supplier: {newSupplier.duplicates.map((d) => d.name).join(", ")}. Choose them from the search instead, or say why this is a different business.</p>
                <Input aria-label="Why this is a different supplier" value={newSupplier.why} onChange={(e) => setNewSupplier({ ...newSupplier, why: e.target.value })} placeholder="e.g. different branch, own account" />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewSupplier(null)}>Close</Button>
          <Button onClick={createSupplier}>Add supplier</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
