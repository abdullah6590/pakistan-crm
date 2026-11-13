"use client";
// src/app/dashboard/sales/new/paper-sale-client.tsx - The sale screen, laid out like the old program's Customer Invoice
// and Cash Sale (owner's video, 2026-11-11) in the new design. One row per item, typed across with Enter: item, size,
// gm, kg per packet, rate per kg, price per packet, packets, price per sheet, loose sheets, total sheets, amount.
// Paper is sold in packets of 100 sheets by default; Labour is a row like any item (a service: no stock). It saves into
// Books as before, so stock, ledgers and Profit & Loss stay right.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FilePlus2, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { NewCustomerDialog } from "@/components/shared/new-customer-dialog";
import { cn } from "@/lib/utils";

// ─── Data ───────────────────────────────────────────────────────────
export interface SaleItemOption {
  id: string; name: string; sku: string; quantity: number; unitCost: number; unitPrice: number;
  dimensionX?: number | null; dimensionY?: number | null; gsm?: number | null; divisor?: number | null; ratePerKg?: number | null;
  /** Sale rate per kg (old "Sale Price"); the purchase rate is `ratePerKg` */
  saleRatePerKg?: number | null;
  /** Short product number (old "ID"): typed with Enter to pick the item */
  itemNo?: number | null;
  size?: string | null; grams?: number | null;
  kind?: string; baseUnit?: string; saleUnit?: string; units?: { code: string; factor: number }[];
}
export interface SaleCustomerOption { id: string; name: string; phone: string; partyNo?: number | null }

/** A typed short number (digits only), else null. */
const shortNo = (t: string) => (/^\d{1,9}$/.test(t.trim()) && Number(t.trim()) > 0 ? Number(t.trim()) : null);

/** A saved bill opened for correction (edit mode). */
export interface EditBill {
  id: string; invoiceNumber: string; type: string; date: string;
  customer: SaleCustomerOption | null; walkInName: string | null; amountReceived: string | null; notes: string | null;
  items: {
    quantity: number; unit?: string; loose?: number; baseQuantity?: number; unitPrice: number; component: SaleItemOption;
    paper?: { x: string; y: string; gsm: string; divisor: string | null; rate: string | null } | null;
  }[];
}

interface Row {
  key: string;
  item: SaleItemOption | null;
  /** What is typed in the item box while searching */
  query: string;
  unit: string;
  x: string; y: string; gsm: string; divisor: string; rate: string;
  /** Price per unit (packet) as typed; when not typed it follows kg x rate */
  price: string; priceTyped: boolean;
  qty: string; loose: string;
}

/** An empty row. Its key is given by the screen's own counter, so the page drawn on the server and in the browser
 * name every row the same (a counter shared by all screens gave the two sides different names, and the cursor got lost). */
const emptyRow = (key: string): Row => ({ key, item: null, query: "", unit: "", x: "", y: "", gsm: "", divisor: "15500", rate: "", price: "", priceTyped: false, qty: "", loose: "" });
const num = (v: string | number | null | undefined) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** A number as typed: digits and one point, at most `dp` decimals, no leading zeros. */
const decimal = (text: string, dp: number) => {
  const [whole, ...rest] = text.replace(/[^\d.]/g, "").split(".");
  const w = whole.replace(/^0+(?=\d)/, "");
  return rest.length ? `${w || "0"}.${rest.join("").slice(0, dp)}` : w;
};
const whole = (text: string) => text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
const fmt = (n: number, dp = 2) => n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: dp });

// ─── Row arithmetic (the old program's formulas) ────────────────────
const factorOf = (r: Row) => r.item?.units?.find((u) => u.code === r.unit)?.factor ?? 1;
const isPack = (r: Row) => !!r.item?.baseUnit && r.unit !== r.item.baseUnit;
const isService = (r: Row) => r.item?.kind === "SERVICE";
/** Kg of one unit of the row: 100 sheets weigh X x Y x gm / divisor (old "Kg"), a packet of 500 five times that. */
const kgPerUnit = (r: Row) => {
  const [x, y, g, d] = [num(r.x), num(r.y), num(r.gsm), num(r.divisor) || 15500];
  if (!(x > 0 && y > 0 && g > 0)) return null;
  return ((x * y * g) / d) * (factorOf(r) / 100);
};
const isPaper = (r: Row) => kgPerUnit(r) !== null;
/** Price per unit worked out from kg x rate (old "Price1"), to 4 decimals as the old screen kept it. */
const calcPrice = (r: Row) => {
  const kg = kgPerUnit(r);
  return kg !== null && num(r.rate) > 0 ? Math.round(kg * num(r.rate) * 10000) / 10000 : null;
};
const priceOf = (r: Row) => (r.priceTyped || calcPrice(r) === null ? num(r.price) : (calcPrice(r) as number));
/** Stock units (sheets) of the row: packets x sheets per packet + loose sheets (old "T.Qty"). */
const sheetsOf = (r: Row) => num(r.qty) * factorOf(r) + (isPack(r) ? num(r.loose) : 0);
/** As Books prices it: whole units at their price, loose sheets at the price per sheet. */
const amountOf = (r: Row) => priceOf(r) * num(r.qty) + (isPack(r) ? (priceOf(r) / factorOf(r)) * num(r.loose) : 0);
const weightOf = (r: Row) => { const kg = kgPerUnit(r); return kg === null ? 0 : (kg / factorOf(r)) * sheetsOf(r); };

function rowFor(item: SaleItemOption, prev: Row): Row {
  const unit = item.saleUnit ?? item.baseUnit ?? "";
  const hasSize = !!(item.dimensionX && item.dimensionY && item.gsm);
  const saleRate = item.saleRatePerKg || item.ratePerKg;
  return {
    ...prev, item, query: "", unit,
    x: hasSize ? String(item.dimensionX) : "", y: hasSize ? String(item.dimensionY) : "", gsm: hasSize ? String(item.gsm) : "",
    divisor: String(item.divisor || 15500), rate: hasSize && saleRate ? String(saleRate) : "",
    // Without a size the item is priced per unit as before; with one the price follows kg x rate
    price: hasSize && saleRate ? "" : item.unitPrice ? String(item.unitPrice) : "", priceTyped: !(hasSize && saleRate),
    qty: prev.qty || "", loose: "",
  };
}

interface Props {
  initialItems: SaleItemOption[];
  initialCustomers: SaleCustomerOption[];
  editBill?: EditBill;
  /** Open as a Cash Sale (walk-in), as the Classic menu's Cash Sale does */
  startWalkIn?: boolean;
}

export default function PaperSaleClient({ initialItems, initialCustomers, editBill, startWalkIn = false }: Props) {
  const router = useRouter();
  const editing = !!editBill;
  const [cashSale, setCashSale] = useState(editBill ? editBill.type === "CASH_SALE" : startWalkIn);
  const [date, setDate] = useState(editBill?.date ?? new Date().toISOString().slice(0, 10));
  const [customer, setCustomer] = useState<SaleCustomerOption | null>(editBill?.customer ?? null);
  const [walkInName, setWalkInName] = useState(editBill?.walkInName ?? (startWalkIn ? "Cash sale" : ""));
  const [balance, setBalance] = useState<number | null>(null);
  const [notes, setNotes] = useState(editBill?.notes ?? "");
  const [reason, setReason] = useState("");
  // "" = the default: a cash sale is paid in full, a customer's invoice goes on account (as on the old screens)
  const [received, setReceived] = useState(editBill?.amountReceived ?? "");
  const [method, setMethod] = useState("CASH");
  const [saving, setSaving] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const isInvoiceEdit = editing && editBill!.type === "SALE_INVOICE";

  // Stock already on the bill being edited goes back when it is saved, so this bill may use it
  const onBill = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of editBill?.items ?? []) m.set(i.component.id, (m.get(i.component.id) ?? 0) + (i.baseQuantity ?? i.quantity));
    return m;
  }, [editBill]);
  const available = useCallback((it: SaleItemOption) => it.quantity + (onBill.get(it.id) ?? 0), [onBill]);

  // Rows are numbered by this screen: the bill's own lines r0, r1, ... then one empty row; new rows continue the count
  const nextRow = useRef((editBill?.items.length ?? 0) + 1);
  const newRow = () => emptyRow(`r${nextRow.current++}`);
  const [rows, setRows] = useState<Row[]>(() => {
    const loaded = (editBill?.items ?? []).map((i, n) => {
      const r = rowFor(i.component, emptyRow(`r${n}`));
      return {
        ...r, unit: i.unit ?? r.unit, qty: String(i.quantity), loose: i.loose ? String(i.loose) : "",
        ...(i.paper ? { x: i.paper.x, y: i.paper.y, gsm: i.paper.gsm, divisor: i.paper.divisor ?? "15500", rate: i.paper.rate ?? "" } : {}),
        price: String(i.unitPrice), priceTyped: true,
      };
    });
    return [...loaded, emptyRow(`r${loaded.length}`)];
  });
  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // ─── Customer ───
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<{ q: string; items: SaleCustomerOption[] } | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  /** Enter on a customer number that is not in the list yet: ask the server for exactly that number. */
  const pickCustomerNo = async (no: number) => {
    const d = await fetch(`/api/search/customers?q=${no}&limit=5`).then((x) => x.json()).catch(() => null);
    const hit = (d?.data as SaleCustomerOption[] | undefined)?.find((c) => c.partyNo === no);
    if (!hit) { toast.error(`No customer with number ${no}`); return; }
    setCustomer({ ...hit, phone: hit.phone ?? "" }); setCustQuery(""); setCustOpen(false); setFocusNext(`${rows[0].key}:item`);
  };
  const custNo = shortNo(custQuery);
  const custList = custQuery.trim().length < 2 && !custNo ? (custQuery.trim() ? [] : initialCustomers) : custResults?.q === custQuery ? custResults.items : [];
  useEffect(() => {
    if (custQuery.trim().length < 2 && !shortNo(custQuery)) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search/customers?q=${encodeURIComponent(custQuery)}&limit=10`, { signal: c.signal })
        .then((r) => r.json()).then((d) => setCustResults({ q: custQuery, items: d.data ?? [] })).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); c.abort(); };
  }, [custQuery]);
  // The customer's balance before this bill (old "Balance"), when this user may see it
  useEffect(() => {
    if (!customer) return;
    const c = new AbortController();
    fetch(`/api/sales/payments?customerId=${customer.id}`, { signal: c.signal })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setBalance(d?.account ? Number(d.account.balance) : null)).catch(() => {});
    return () => c.abort();
  }, [customer]);

  // ─── Item search (one open box at a time) ───
  const [searchRow, setSearchRow] = useState<string | null>(null);
  // Where the open list is drawn: under its item box, on top of the page, so the grid's scrolling box never cuts it off
  const [listAt, setListAt] = useState<{ left: number; top: number } | null>(null);
  const placeList = (el: HTMLElement) => { const b = el.getBoundingClientRect(); setListAt({ left: b.left, top: b.bottom + 4 }); };
  useEffect(() => {
    if (!searchRow) return;
    // The page or the grid scrolled: follow the item box
    const follow = () => { const el = grid.current?.querySelector<HTMLElement>(`[data-cell="${searchRow}:item"]`); if (el) placeList(el); };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); };
  }, [searchRow]);
  const [searchResults, setSearchResults] = useState<{ q: string; items: SaleItemOption[] } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const activeQuery = rows.find((r) => r.key === searchRow)?.query ?? "";
  // One letter or digit (the old program had items called "a") filters the starting list; two or more search everything
  const q1 = activeQuery.trim().toLowerCase();
  const itemNo = shortNo(activeQuery);
  const matches = (q1.length === 0 ? initialItems
    : q1.length === 1 ? initialItems.filter((m) => m.itemNo === itemNo || m.name.toLowerCase().startsWith(q1) || m.sku.toLowerCase().startsWith(q1))
    : searchResults?.q === activeQuery ? searchResults.items : [])
    // The product with the typed number comes first, so Enter picks it
    .slice().sort((a, b) => Number(itemNo !== null && b.itemNo === itemNo) - Number(itemNo !== null && a.itemNo === itemNo));
  useEffect(() => {
    if (activeQuery.trim().length < 2) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search/components?q=${encodeURIComponent(activeQuery)}&limit=12`, { signal: c.signal })
        .then((r) => r.json()).then((d) => setSearchResults({ q: activeQuery, items: d.data ?? [] })).catch(() => {});
    }, 180);
    return () => { clearTimeout(t); c.abort(); };
  }, [activeQuery]);

  // ─── Keyboard: Enter moves across the row, then to the next row (a new one at the end) ───
  const grid = useRef<HTMLTableSectionElement>(null);
  // A box to focus once the next render has drawn it (a new row, or the price after picking an item)
  const pendingFocus = useRef<string | null>(null);
  const setFocusNext = (cell: string) => { pendingFocus.current = cell; };
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    // The box may not be ready on the first frame (the item box it replaces is still leaving): try for a few frames,
    // so the cursor never ends up nowhere and the next keys are not lost on a slow computer
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const el = grid.current?.querySelector<HTMLInputElement>(`[data-cell="${want}"]`);
      if (el && !el.disabled) {
        el.focus();
        if (document.activeElement === el) { if (pendingFocus.current === want) pendingFocus.current = null; return; }
      }
      if (++tries < 30) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  });
  const moveOn = (from: HTMLElement) => {
    const cells = Array.from(grid.current?.querySelectorAll<HTMLInputElement>("[data-cell]:not([disabled])") ?? []);
    const i = cells.indexOf(from as HTMLInputElement);
    if (i >= 0 && i < cells.length - 1) { cells[i + 1].focus(); return; }
    // Past the last box of the last row: a new row, ready for the next item
    const last = rows[rows.length - 1];
    if (last.item) {
      const r = newRow();
      setRows((rs) => [...rs, r]);
      setFocusNext(`${r.key}:item`);
    }
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    moveOn(e.currentTarget);
  };

  /** Enter on a product number that is not in the list yet: ask the server for exactly that number. */
  const pickItemNo = async (row: Row, no: number) => {
    const d = await fetch(`/api/search/components?q=${no}&limit=5`).then((x) => x.json()).catch(() => null);
    const hit = (d?.data as SaleItemOption[] | undefined)?.find((m) => m.itemNo === no);
    if (hit) pick(row, hit); else toast.error(`No product with number ${no}`);
  };
  const pick = (row: Row, item: SaleItemOption) => {
    setSearchRow(null);
    const next = rowFor(item, row);
    setRows((rs) => {
      const updated = rs.map((r) => (r.key === row.key ? next : r));
      return updated[updated.length - 1].item ? [...updated, newRow()] : updated;
    });
    // Paper goes to its rate per kg; anything else to its price when it has none yet (Labour), otherwise the quantity
    const hasSize = !!(item.dimensionX && item.dimensionY && item.gsm);
    setFocusNext(`${row.key}:${hasSize ? "rate" : item.unitPrice ? "qty" : "price"}`);
  };
  const removeRow = (key: string) => setRows((rs) => {
    const left = rs.filter((r) => r.key !== key);
    return left.length && left[left.length - 1].item === null ? left : [...left, newRow()];
  });

  // ─── Totals (old T-Rim, Sheet, T-Sheet, Net Wait, Net Amount) ───
  const filled = rows.filter((r) => r.item);
  const paperRows = filled.filter(isPaper);
  const totals = {
    packets: paperRows.reduce((t, r) => t + (isPack(r) ? num(r.qty) : 0), 0),
    loose: paperRows.reduce((t, r) => t + (isPack(r) ? num(r.loose) : 0), 0),
    sheets: paperRows.reduce((t, r) => t + sheetsOf(r), 0),
    weight: paperRows.reduce((t, r) => t + weightOf(r), 0),
    amount: filled.reduce((t, r) => t + amountOf(r), 0),
  };
  const net = Math.round(totals.amount);
  const receivedNow = received === "" ? (cashSale ? net : 0) : Math.min(num(received), net);
  const owedOnBill = net - receivedNow;

  // ─── Save ───
  const problem = (): string | null => {
    if (!filled.length) return "Add at least one item";
    if (!cashSale && !customer) return "Choose the customer";
    if (cashSale && !walkInName.trim()) return "Enter the customer's name";
    for (const r of filled) {
      const name = r.item!.name;
      if (!(num(r.qty) > 0) && !(isPack(r) && num(r.loose) > 0)) return `${name}: enter the quantity`;
      if (isPack(r) && num(r.loose) >= factorOf(r)) return `${name}: loose sheets must be fewer than one ${r.unit} (${factorOf(r)})`;
      if (!(priceOf(r) > 0)) return `${name}: enter the price${isPaper(r) ? " or the rate per kg" : ""}`;
      if (!isService(r) && sheetsOf(r) > available(r.item!)) return `${name}: only ${fmt(available(r.item!), 0)} ${r.item!.baseUnit ?? ""} in stock`;
    }
    if (received !== "" && num(received) > net) return "Received now is more than the bill";
    if (editing && reason.trim().length < 3) return "Give a reason for the change";
    return null;
  };

  const save = async () => {
    const p = problem();
    if (p) { toast.error(p); return; }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/sales/${editBill!.id}` : "/api/sales", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          customerId: cashSale ? null : customer!.id,
          walkInName: cashSale ? walkInName.trim() : null,
          notes: notes.trim() || null,
          ...(isInvoiceEdit ? {} : { paidNow: { amount: String(receivedNow), method } }),
          ...(editing ? { reason: reason.trim() } : { requestId }),
          items: filled.map((r) => ({
            componentId: r.item!.id,
            quantity: num(r.qty),
            unit: r.unit || undefined,
            loose: isPack(r) && num(r.loose) > 0 ? num(r.loose) : undefined,
            unitPrice: String(priceOf(r)),
            paper: isPaper(r) ? { x: r.x, y: r.y, gsm: r.gsm, divisor: r.divisor || null, ratePerKg: r.rate || null } : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The bill was not saved");
      if (data.pending) {
        toast.success(`Saved on this computer as ${data.entry.provisionalRef ?? "a pending entry"}; it gets its number when it syncs`, { duration: 10000 });
        router.push("/dashboard/sales");
        return;
      }
      toast.success(`Bill ${data.sale.docNo} saved`);
      const freed = (data.releasedCredit ?? []).reduce((t: number, c: { amount: string }) => t + Number(c.amount), 0);
      if (freed > 0) toast.info(`${formatCurrency(freed)} already paid no longer fits this bill; it is now the customer's credit.`, { duration: 12000 });
      router.push(`/dashboard/sales/${data.sale.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The bill was not saved");
    } finally {
      setSaving(false);
    }
  };
  // Ctrl+S saves, as a desktop program would (the browser's own "save page" is not wanted here)
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const step = async (dir: "first" | "prev" | "next" | "last") => {
    const type = cashSale ? "CASH_SALE" : "SALE_INVOICE";
    const res = await fetch(`/api/sales/step?type=${type}&dir=${dir}${editBill ? `&from=${editBill.id}` : ""}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || "Could not open the bill"); return; }
    if (!data.bill) { toast.info(dir === "next" ? "This is the last bill" : dir === "prev" ? "This is the first bill" : "No bills yet"); return; }
    router.push(`/dashboard/sales/${data.bill.id}`);
  };

  const title = editing ? `Edit ${cashSale ? "cash sale" : "invoice"} ${editBill!.invoiceNumber}` : cashSale ? "Cash Sale" : "Customer Invoice";
  const unitLabel = (r: Row) => r.unit || r.item?.baseUnit || "";

  // ─── Layout ─────────────────────────────────────────────────────────
  const th = "px-2 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap";
  const thNum = `${th} text-right`;
  const cellInput = "h-8 px-2 text-right tabular-nums";
  const shown = "px-2 py-1 text-right tabular-nums whitespace-nowrap text-sm";

  return (
    <div className="space-y-4">
      <NewCustomerDialog
        open={newCustomerOpen}
        initialText={custQuery}
        onClose={() => setNewCustomerOpen(false)}
        onCreated={(c) => { setCustomer(c); setCustQuery(""); setNewCustomerOpen(false); }}
      />

      {/* Title row: which bill, its number and date, and the kind switch */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">Enter moves to the next box; at the end of a row it opens a new one. Ctrl+S saves.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!editing && (
            <div role="radiogroup" aria-label="Kind of bill" className="inline-flex rounded-lg border p-0.5">
              {([["invoice", "Customer invoice"], ["cash", "Cash sale"]] as const).map(([k, label]) => {
                const on = (k === "cash") === cashSale;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => { setCashSale(k === "cash"); setReceived(""); if (k === "cash" && !walkInName) setWalkInName("Cash sale"); }}
                    className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="sale-date" className="text-xs">Date</Label>
            <Input id="sale-date" type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Bill no </span>
            <span className="font-semibold tabular-nums">{editing ? editBill!.invoiceNumber : "New"}</span>
          </div>
        </div>
      </div>

      {/* Customer and totals (old Cus-Id, Customer, Balance; T-Rim, Sheet, T-Sheet, Net Wait) */}
      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-2">
            {cashSale ? (
              <div className="max-w-md space-y-1">
                <Label htmlFor="walkin">Customer name</Label>
                <Input id="walkin" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="Cash sale" />
              </div>
            ) : customer ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  <p className="font-semibold">{customer.name}{customer.phone && <span className="ml-2 text-sm font-normal text-muted-foreground">{customer.phone}</span>}</p>
                </div>
                {balance !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Balance before this bill</p>
                    <p className={cn("font-semibold tabular-nums", balance > 0 && "text-amber-700 dark:text-amber-400")}>{formatCurrency(balance)}</p>
                  </div>
                )}
                {!editing && <Button type="button" variant="ghost" size="sm" onClick={() => { setCustomer(null); setBalance(null); }}>Change</Button>}
              </div>
            ) : (
              <div className="relative max-w-md space-y-1">
                <Label htmlFor="cust">Customer</Label>
                <Input
                  id="cust" autoFocus placeholder="Type the customer's name or phone"
                  value={custQuery}
                  onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); }}
                  onFocus={() => setCustOpen(true)}
                  onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                  onKeyDown={(e) => {
                    // F1 opens the customer list (old program); a typed number + Enter picks that customer
                    if (e.key === "F1") { e.preventDefault(); setCustQuery(""); setCustOpen(true); return; }
                    if (e.key === "Enter" && custNo && !custList.some((c) => c.partyNo === custNo)) { e.preventDefault(); void pickCustomerNo(custNo); return; }
                    if (e.key === "Enter" && custList[0]) { e.preventDefault(); setCustomer(custList[0]); setCustQuery(""); setCustOpen(false); setFocusNext(`${rows[0].key}:item`); }
                    if (e.key === "Escape") setCustOpen(false);
                  }}
                  role="combobox" aria-expanded={custOpen} aria-controls="cust-list" aria-autocomplete="list"
                />
                {custOpen && (
                  <div id="cust-list" role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-background shadow-lg">
                    {custList.map((c) => (
                      <button key={c.id} type="button" role="option" aria-selected={false}
                        className="flex w-full flex-col items-start border-b px-3 py-2 text-left hover:bg-muted"
                        onMouseDown={(e) => { e.preventDefault(); setCustomer(c); setCustQuery(""); setCustOpen(false); setFocusNext(`${rows[0].key}:item`); }}>
                        <span className="text-sm font-medium">{c.name}</span>
                        {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                      </button>
                    ))}
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                      onMouseDown={(e) => { e.preventDefault(); setCustOpen(false); setNewCustomerOpen(true); }}>
                      <UserPlus className="h-4 w-4" aria-hidden /> {custQuery.trim() ? `New customer "${custQuery.trim()}"` : "New customer"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-sm sm:grid-cols-5" aria-label="Bill totals">
            {[
              ["Packets", fmt(totals.packets, 0)], ["Loose sheets", fmt(totals.loose, 0)], ["Total sheets", fmt(totals.sheets, 0)],
              ["Net weight", `${fmt(totals.weight, 2)} kg`], ["Net amount", formatCurrency(net)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className={cn("font-semibold tabular-nums", k === "Net amount" && "text-lg")}>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* The rows, typed across */}
      <Card>
        <CardContent className="p-0">
          {/* relative: hidden screen-reader labels inside the grid are placed in this box, so they cannot widen the page */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className={`${th} w-8`}>#</th>
                  <th className={`${th} min-w-[220px]`}>Item</th>
                  <th className={thNum}>X</th>
                  <th className={thNum}>Y</th>
                  <th className={thNum}>gm</th>
                  <th className={thNum}>Kg / packet</th>
                  <th className={thNum}>Rate / kg</th>
                  <th className={thNum}>Price / packet</th>
                  <th className={thNum}>Packets</th>
                  <th className={thNum}>Sheets / packet</th>
                  <th className={thNum}>Price / sheet</th>
                  <th className={thNum}>Loose sheets</th>
                  <th className={thNum}>Total sheets</th>
                  <th className={thNum}>Amount</th>
                  <th className={`${th} w-10`}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody ref={grid}>
                {rows.map((r, i) => {
                  const kg = kgPerUnit(r);
                  const calc = calcPrice(r);
                  const pack = isPack(r);
                  const service = isService(r);
                  const short = r.item && !service && sheetsOf(r) > available(r.item);
                  const open = searchRow === r.key;
                  return (
                    <Fragment key={r.key}>
                      <tr className={cn("border-b align-middle", short && "bg-destructive/5")}>
                        <td className="px-2 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="relative px-2 py-1">
                          {r.item && !open ? (
                            <button type="button" data-cell={`${r.key}:item`}
                              className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => { setRow(r.key, { query: "" }); setSearchRow(r.key); setHighlight(0); setFocusNext(`${r.key}:item`); }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); moveOn(e.currentTarget); } }}
                              title="Change the item">
                              <span className="font-medium">{r.item.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {r.item.sku}{service ? " · service" : ` · stock ${stockText(r.item, available(r.item))}`}
                              </span>
                            </button>
                          ) : (
                            <>
                              <Input data-cell={`${r.key}:item`} className="h-8" placeholder={i === 0 ? "Type item name or code" : "Next item"}
                                value={r.query} aria-label={`Item, row ${i + 1}`}
                                role="combobox" aria-expanded={open && matches.length > 0} aria-controls={`items-${r.key}`} aria-autocomplete="list"
                                onFocus={(e) => { placeList(e.currentTarget); setSearchRow(r.key); setHighlight(0); }}
                                onBlur={() => setTimeout(() => setSearchRow((s) => (s === r.key ? null : s)), 150)}
                                onChange={(e) => { placeList(e.currentTarget); setRow(r.key, { query: e.target.value }); setSearchRow(r.key); setHighlight(0); }}
                                onKeyDown={(e) => {
                                  if (e.key === "F1") { e.preventDefault(); setRow(r.key, { query: "" }); setSearchRow(r.key); setHighlight(0); }
                                  else if (e.key === "Enter" && itemNo && !matches.some((m) => m.itemNo === itemNo)) { e.preventDefault(); void pickItemNo(r, itemNo); }
                                  else if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
                                  else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
                                  else if (e.key === "Escape") setSearchRow(null);
                                  else if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (matches[highlight]) pick(r, matches[highlight]);
                                    else if (!r.query.trim() && filled.length) { /* empty last row: go to Received / Save */ document.getElementById("received")?.focus(); }
                                  }
                                }} />
                              {open && matches.length > 0 && listAt && (
                                <div id={`items-${r.key}`} role="listbox" style={{ left: listAt.left, top: listAt.top }}
                                  className="fixed z-40 max-h-72 w-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border bg-background shadow-lg">
                                  {matches.map((m, mi) => (
                                    <button key={m.id} type="button" role="option" aria-selected={mi === highlight}
                                      className={cn("flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-0", mi === highlight ? "bg-muted" : "hover:bg-muted")}
                                      onMouseDown={(e) => { e.preventDefault(); pick(r, m); }}>
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">{m.name}</span>
                                        <span className="block text-xs text-muted-foreground">
                                          {m.itemNo ? `No. ${m.itemNo} · ` : ""}{m.sku}{m.dimensionX && m.dimensionY && m.gsm ? ` · ${m.dimensionX}x${m.dimensionY} · ${m.gsm} gm` : ""}
                                        </span>
                                      </span>
                                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        {m.kind === "SERVICE" ? "service" : stockText(m, available(m))}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        {(["x", "y", "gsm"] as const).map((f) => (
                          <td key={f} className="px-1 py-1">
                            <Input data-cell={`${r.key}:${f}`} disabled={!r.item || service} className={`${cellInput} w-16`} inputMode="decimal"
                              aria-label={`${f === "gsm" ? "gm" : f.toUpperCase()}, row ${i + 1}`} value={r[f]}
                              onFocus={(e) => e.target.select()} onKeyDown={onEnter}
                              onChange={(e) => setRow(r.key, { [f]: decimal(e.target.value, f === "gsm" ? 2 : 3) })} />
                          </td>
                        ))}
                        <td className={shown}>{kg === null ? "" : fmt(kg, 4)}</td>
                        <td className="px-1 py-1">
                          <Input data-cell={`${r.key}:rate`} disabled={!r.item || service || kg === null} className={`${cellInput} w-20`} inputMode="decimal"
                            aria-label={`Rate per kg, row ${i + 1}`} value={r.rate} placeholder={kg === null ? "" : "0"}
                            onFocus={(e) => e.target.select()} onKeyDown={onEnter}
                            onChange={(e) => setRow(r.key, { rate: decimal(e.target.value, 4), priceTyped: false })} />
                        </td>
                        <td className="px-1 py-1">
                          <Input data-cell={`${r.key}:price`} disabled={!r.item} className={`${cellInput} w-28`} inputMode="decimal"
                            aria-label={`Price per ${unitLabel(r) || "unit"}, row ${i + 1}`}
                            value={r.priceTyped || calc === null ? r.price : String(calc)}
                            onFocus={(e) => e.target.select()} onKeyDown={onEnter}
                            onChange={(e) => setRow(r.key, { price: decimal(e.target.value, 4), priceTyped: true })} />
                          {r.priceTyped && calc !== null && calc !== num(r.price) && (
                            <button type="button" className="mt-0.5 block w-full text-right text-[11px] text-primary underline-offset-2 hover:underline"
                              onClick={() => setRow(r.key, { priceTyped: false })}>Use kg x rate: {fmt(calc, 4)}</button>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <div className="flex items-center justify-end gap-1">
                            <Input data-cell={`${r.key}:qty`} disabled={!r.item} className={`${cellInput} w-20`} inputMode="numeric"
                              aria-label={`${unitLabel(r) || "Quantity"}, row ${i + 1}`} value={r.qty}
                              onFocus={(e) => e.target.select()} onKeyDown={onEnter}
                              onChange={(e) => setRow(r.key, { qty: r.item?.kind === "WEIGHT" ? decimal(e.target.value, 3) : whole(e.target.value) })} />
                            {r.item && (r.item.units?.length ?? 0) > 1 ? (
                              <select aria-label={`Unit, row ${i + 1}`} className="h-8 rounded-md border bg-background px-1 text-xs"
                                value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value, loose: "" })}>
                                {r.item.units!.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                              </select>
                            ) : r.item ? <span className="w-12 text-xs text-muted-foreground">{unitLabel(r)}</span> : null}
                          </div>
                        </td>
                        <td className={shown}>{r.item && pack ? fmt(factorOf(r), 0) : ""}</td>
                        <td className={shown}>{r.item && pack && priceOf(r) > 0 ? fmt(priceOf(r) / factorOf(r), 4) : ""}</td>
                        <td className="px-1 py-1">
                          <Input data-cell={`${r.key}:loose`} disabled={!r.item || !pack} className={`${cellInput} w-16`} inputMode="numeric"
                            aria-label={`Loose ${r.item?.baseUnit ?? "sheets"}, row ${i + 1}`} value={r.loose}
                            onFocus={(e) => e.target.select()} onKeyDown={onEnter}
                            onChange={(e) => setRow(r.key, { loose: whole(e.target.value) })} />
                        </td>
                        <td className={shown}>{r.item && !service ? fmt(sheetsOf(r), 0) : ""}</td>
                        <td className={cn(shown, "font-semibold")}>{r.item ? fmt(amountOf(r), 2) : ""}</td>
                        <td className="px-1 py-1 text-center">
                          {r.item && (
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r.key)}>
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                            </Button>
                          )}
                        </td>
                      </tr>
                      {short && (
                        <tr className="bg-destructive/5"><td /><td colSpan={14} className="px-2 pb-2 text-xs text-destructive">
                          Only {fmt(available(r.item!), 0)} {r.item!.baseUnit} in stock ({stockText(r.item!, available(r.item!))}).
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{filled.length} item{filled.length === 1 ? "" : "s"}</span>
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => {
              const r = newRow(); setRows((rs) => (rs[rs.length - 1].item ? [...rs, r] : rs)); setFocusNext(`${rows[rows.length - 1].item ? r.key : rows[rows.length - 1].key}:item`);
            }}><Plus className="h-3.5 w-3.5" aria-hidden /> Add row</Button>
          </div>
        </CardContent>
      </Card>

      {/* Remarks, money and the old program's buttons */}
      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="remarks">Remarks</Label>
              <Input id="remarks" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the bill" />
            </div>
            {editing && (
              <div className="space-y-1">
                <Label htmlFor="reason">Reason for the change *</Label>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer took 3 packets more" />
                <p className="text-xs text-muted-foreground">The bill keeps its number; the earlier version and this reason stay in its history.</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {isInvoiceEdit ? (
              <p className="text-sm text-muted-foreground">Payments already received stay with this bill. Receive more from the bill page.</p>
            ) : (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="received">{cashSale ? "Cash received" : "Received now"}</Label>
                  <Input id="received" inputMode="decimal" className="tabular-nums" value={received === "" ? String(receivedNow) : received}
                    onFocus={(e) => e.target.select()} onChange={(e) => setReceived(decimal(e.target.value, 2))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("save-bill")?.focus(); } }} />
                </div>
                <Select value={method} onChange={(v: string) => setMethod(v)}>
                  <SelectTrigger className="w-36" aria-label="Paid by"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Net amount</dt><dd className="font-semibold tabular-nums">{formatCurrency(net)}</dd></div>
              {!isInvoiceEdit && <div className="flex justify-between"><dt className="text-muted-foreground">Left to pay on this bill</dt><dd className="tabular-nums">{formatCurrency(owedOnBill)}</dd></div>}
              {!cashSale && balance !== null && !editing && (
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">Customer&apos;s balance after this bill</dt><dd className="font-semibold tabular-nums">{formatCurrency(balance + owedOnBill)}</dd></div>
              )}
            </dl>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 lg:col-span-2">
            <div className="flex gap-1" role="group" aria-label="Step through bills">
              {([["first", ChevronFirst, "First bill"], ["prev", ChevronLeft, "Previous bill"], ["next", ChevronRight, "Next bill"], ["last", ChevronLast, "Last bill"]] as const).map(([d, Icon, label]) => (
                <Button key={d} type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={label} title={label} onClick={() => step(d)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={() => router.push(cashSale ? "/dashboard/sales/new?walkin=1" : "/dashboard/sales/new")} disabled={saving}>
                <FilePlus2 className="h-4 w-4" aria-hidden /> New
              </Button>
              <Button id="save-bill" type="button" className="gap-2" onClick={save} disabled={saving}>
                <Save className="h-4 w-4" aria-hidden /> {saving ? "Saving..." : editing ? "Save changes" : "Save bill"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Stock as the old stock report shows it: "275 packets 19 sheets" for paper, plain count otherwise. */
export function stockText(item: Pick<SaleItemOption, "baseUnit" | "saleUnit" | "units">, base: number): string {
  const packUnit = item.saleUnit && item.saleUnit !== item.baseUnit ? item.units?.find((u) => u.code === item.saleUnit) : undefined;
  if (!packUnit || packUnit.factor <= 1) return `${fmt(base, 3)} ${item.baseUnit ?? ""}`.trim();
  const whole = Math.trunc(base / packUnit.factor);
  const rest = Math.round((base - whole * packUnit.factor) * 1000) / 1000;
  return `${fmt(whole, 0)} ${packUnit.code}${whole === 1 ? "" : "s"}${rest ? ` ${fmt(rest, 3)} ${item.baseUnit}${rest === 1 ? "" : "s"}` : ""}`;
}
