"use client";
// src/app/dashboard/sales/new/paper-sale-client.tsx - The sale screen, laid out like the old program's Customer Invoice
// and Cash Sale (owner's video, 2026-11-11) in the new design. One row per item, typed across with Enter: item, size,
// gm, kg per packet, rate per kg, price per packet, packets, price per sheet, loose sheets, total sheets, amount.
// Paper is sold in packets of 100 sheets by default; Labour is a row like any item (a service: no stock). It saves into
// Books as before, so stock, ledgers and Profit & Loss stay right.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FilePlus2, Pencil, Plus, Printer, Receipt, Save, Search, Trash2, UserPlus, X } from "lucide-react";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency, formatPaisa } from "@/lib/utils";
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
  kind?: string; baseUnit?: string; saleUnit?: string; purchaseUnit?: string; units?: { code: string; factor: number }[];
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
    remarks?: string | null;
  }[];
  /** Cash sale: the walk-in customer's phone (old "Cell No") */
  walkInPhone?: string | null;
  /** Supplier invoice: the supplier's own bill number and date, the bilty (BL) number and date */
  vendorBillNo?: string | null; vendorBillDate?: string | null; biltyNo?: string | null; biltyDate?: string | null;
  /** A supplier bill's due date (entered on New purchase); the desk has no box for it, so an edit keeps it */
  dueDate?: string | null;
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
  /** The line's own remark (old grid "Remarks") */
  remarks: string;
  /** The "entered in sheets, did you mean packets?" question was answered for this row (or the row came from a saved bill) */
  sheetsOk: boolean;
}

/** An empty row. Its key is given by the screen's own counter, so the page drawn on the server and in the browser
 * name every row the same (a counter shared by all screens gave the two sides different names, and the cursor got lost). */
const emptyRow = (key: string): Row => ({ key, item: null, query: "", unit: "", x: "", y: "", gsm: "", divisor: "15500", rate: "", price: "", priceTyped: false, qty: "", loose: "", remarks: "", sheetsOk: false });
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
/** The packet of an item counted in sheets (paper). As in the old program such a row is always packets + loose sheets:
 * the price and kg are per packet and single sheets go in Loose sheets (Report 32: Amount = P-Price x Rim + S.Price x Sheet). */
const packetOf = (r: Row) =>
  r.item?.baseUnit === "sheet" ? r.item.units?.find((u) => u.code === "packet" && u.factor > 1) : undefined;
/** The units the row's unit box offers: the single sheet is left out where a packet exists (it is the Loose sheets box),
 * unless a saved bill's line was entered in sheets. */
const unitsFor = (r: Row) => (r.item?.units ?? []).filter((u) => !(packetOf(r) && u.code === r.item!.baseUnit && r.unit !== u.code));
/** Only loose sheets and no packets: usually packets typed in the wrong box (owner 2026-11-16), so asked once per row. */
const asksSheets = (r: Row) => !r.sheetsOk && !!packetOf(r) && r.unit === "packet" && !(num(r.qty) > 0) && num(r.loose) > 0;

function rowFor(item: SaleItemOption, prev: Row, side: "sale" | "purchase" = "sale"): Row {
  const own = (side === "purchase" ? item.purchaseUnit : item.saleUnit) ?? item.saleUnit ?? item.baseUnit ?? "";
  // Paper in sheets with a packet is entered in packets + loose sheets (old program)
  const unit = item.baseUnit === "sheet" && own === "sheet" && item.units?.some((u) => u.code === "packet") ? "packet" : own;
  const hasSize = !!(item.dimensionX && item.dimensionY && item.gsm);
  // A sale starts from the sale rate per kg, a purchase from the purchase rate (old Supplier Invoice)
  const saleRate = side === "purchase" ? item.ratePerKg : item.saleRatePerKg || item.ratePerKg;
  const listPrice = side === "purchase" ? item.unitCost : item.unitPrice;
  return {
    ...prev, item, query: "", unit,
    x: hasSize ? String(item.dimensionX) : "", y: hasSize ? String(item.dimensionY) : "", gsm: hasSize ? String(item.gsm) : "",
    divisor: String(item.divisor || 15500), rate: hasSize && saleRate ? String(saleRate) : "",
    // Without a size the item is priced per unit as before; with one the price follows kg x rate
    price: hasSize && saleRate ? "" : listPrice ? String(listPrice) : "", priceTyped: !(hasSize && saleRate),
    qty: prev.qty || "", loose: "", remarks: prev.remarks, sheetsOk: false,
  };
}

/** The invoice desk (Report 33): the bill shown locked in one window, with the old program's buttons. */
export interface DeskInfo {
  kind: "SALE_INVOICE" | "CASH_SALE" | "PURCHASE_INVOICE";
  locked?: boolean;
  status?: string;
  printCount?: number;
  lastPrintedAt?: string | null;
  total?: string;
  paid?: string;
  remaining?: string;
  /** The customer's balance before and after this bill, as stored when it was saved */
  previousBalance?: string | null;
  newBalance?: string | null;
  canEdit?: boolean;
  canCashUpdate?: boolean;
  /** Receive (or, on a supplier invoice, pay) money against this bill from the desk */
  canPay?: boolean;
  /** Why the money cannot be taken here (shown instead of the button) */
  payNote?: string | null;
  /** Money already set against this bill: cash at the counter, receipts, supplier payments and returns */
  payments?: DeskPayment[];
  canNew?: boolean;
}

export interface DeskPayment { docNo: string; date: string; method: string; amount: string }

interface Props {
  initialItems: SaleItemOption[];
  initialCustomers: SaleCustomerOption[];
  editBill?: EditBill;
  /** Open as a Cash Sale (walk-in), as the Classic menu's Cash Sale does */
  startWalkIn?: boolean;
  /** Shown as the old program's invoice desk */
  desk?: DeskInfo;
  /** "purchase": the Supplier Invoice (the same grid with the supplier and the supplier bill's fields) */
  side?: "sale" | "purchase";
}

export default function PaperSaleClient({ initialItems, initialCustomers, editBill, startWalkIn = false, desk, side = "sale" }: Props) {
  const purchase = side === "purchase";
  // Sale bills are in whole rupees; supplier bills keep the paisa (old Net Value was not rounded)
  const money = (n: number) => (purchase ? formatPaisa(n) : formatCurrency(n));
  const party = purchase ? "supplier" : "customer";
  const router = useRouter();
  // On the desk a saved bill opens locked; Edit unlocks it (the old Edit button)
  const [locked, setLocked] = useState(!!desk?.locked);
  const editing = !!editBill && !locked;
  const deskUrl = (q: string) => purchase ? `/dashboard/purchases/desk?${q}` : `/dashboard/sales/desk?kind=${(desk?.kind ?? (editBill?.type === "CASH_SALE" ? "CASH_SALE" : "SALE_INVOICE")) === "CASH_SALE" ? "cash" : "invoice"}&${q}`;
  const [cashSale, setCashSale] = useState(!purchase && (editBill ? editBill.type === "CASH_SALE" : startWalkIn));
  // Supplier invoice header (old S-Inv #, Inv Date, BL #, BL Date)
  const [vendorBillNo, setVendorBillNo] = useState(editBill?.vendorBillNo ?? "");
  const [vendorBillDate, setVendorBillDate] = useState(editBill?.vendorBillDate ?? "");
  const [biltyNo, setBiltyNo] = useState(editBill?.biltyNo ?? "");
  const [biltyDate, setBiltyDate] = useState(editBill?.biltyDate ?? "");
  const [date, setDate] = useState(editBill?.date ?? new Date().toISOString().slice(0, 10));
  const [customer, setCustomer] = useState<SaleCustomerOption | null>(editBill?.customer ?? null);
  const [walkInName, setWalkInName] = useState(editBill?.walkInName ?? (startWalkIn ? "Cash sale" : ""));
  const [walkInPhone, setWalkInPhone] = useState(editBill?.walkInPhone ?? "");
  const [balance, setBalance] = useState<number | null>(null);
  const [notes, setNotes] = useState(editBill?.notes ?? "");
  const [reason, setReason] = useState("");
  // "" = the default: a cash sale is paid in full, a customer's invoice goes on account (as on the old screens)
  const [received, setReceived] = useState(editBill?.amountReceived ?? "");
  const [method, setMethod] = useState("CASH");
  const [saving, setSaving] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  // Editing an invoice (sale or purchase) keeps its payments; only a cash sale's cash is entered on the bill
  const isInvoiceEdit = editing && editBill!.type !== "CASH_SALE";

  // Stock already on the bill being edited goes back when it is saved, so this bill may use it
  const onBill = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of editBill?.items ?? []) m.set(i.component.id, (m.get(i.component.id) ?? 0) + (i.baseQuantity ?? i.quantity));
    return m;
  }, [editBill]);
  // A sale being edited may use its own quantity again; on a purchase the stock is simply what is in hand
  const available = useCallback((it: SaleItemOption) => it.quantity + (purchase ? 0 : onBill.get(it.id) ?? 0), [onBill, purchase]);

  // Rows are numbered by this screen: the bill's own lines r0, r1, ... then one empty row; new rows continue the count
  const nextRow = useRef((editBill?.items.length ?? 0) + 1);
  const newRow = () => emptyRow(`r${nextRow.current++}`);
  const [rows, setRows] = useState<Row[]>(() => {
    const loaded = (editBill?.items ?? []).map((i, n) => {
      const r = rowFor(i.component, emptyRow(`r${n}`), side);
      return {
        ...r, unit: i.unit ?? r.unit, qty: String(i.quantity), loose: i.loose ? String(i.loose) : "",
        ...(i.paper ? { x: i.paper.x, y: i.paper.y, gsm: i.paper.gsm, divisor: i.paper.divisor ?? "15500", rate: i.paper.rate ?? "" } : {}),
        price: String(i.unitPrice), priceTyped: true, remarks: i.remarks ?? "", sheetsOk: true,
      };
    });
    return [...loaded, emptyRow(`r${loaded.length}`)];
  });
  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  /** Loose sheets of a whole packet or more become packets + loose, as the old T-Qty = packets x size + sheets (250 -> 2 + 50). */
  const foldLoose = (key: string) => setRows((rs) => rs.map((r) => {
    if (r.key !== key || !isPack(r)) return r;
    const f = factorOf(r), loose = num(r.loose);
    if (!(f > 1 && loose >= f)) return r;
    return { ...r, qty: String(num(r.qty) + Math.floor(loose / f)), loose: loose % f ? String(loose % f) : "" };
  }));

  // ─── Customer ───
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<{ q: string; items: SaleCustomerOption[] } | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  /** Enter on a customer number that is not in the list yet: ask the server for exactly that number. */
  const pickCustomerNo = async (no: number) => {
    const d = await fetch(`/api/search/${party}s?q=${no}&limit=5`).then((x) => x.json()).catch(() => null);
    const hit = (d?.data as SaleCustomerOption[] | undefined)?.find((c) => c.partyNo === no);
    if (!hit) { toast.error(`No ${party} with number ${no}`); return; }
    setCustomer({ ...hit, phone: hit.phone ?? "" }); setCustQuery(""); setCustOpen(false);
    // Old Supplier Invoice order: Sup-Id, then S-Inv #, Inv Date, BL #, BL Date, then the grid
    if (purchase) setTimeout(() => document.getElementById("s-inv")?.focus(), 50); else setFocusNext(`${rows[0].key}:item`);
  };
  const custNo = shortNo(custQuery);
  const custList = custQuery.trim().length < 2 && !custNo ? (custQuery.trim() ? [] : initialCustomers) : custResults?.q === custQuery ? custResults.items : [];
  useEffect(() => {
    if (custQuery.trim().length < 2 && !shortNo(custQuery)) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search/${party}s?q=${encodeURIComponent(custQuery)}&limit=10`, { signal: c.signal })
        .then((r) => r.json()).then((d) => setCustResults({ q: custQuery, items: d.data ?? [] })).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); c.abort(); };
  }, [custQuery, party]);
  // The customer's balance before this bill (old "Balance"), when this user may see it
  useEffect(() => {
    // A saved bill on the desk shows the balance stored with it, so today's is not fetched
    if (!customer || (editBill && desk)) return;
    const c = new AbortController();
    // A supplier's balance is what is owed to them (old Supplier Invoice "Balance")
    fetch(purchase ? `/api/suppliers/${customer.id}?summary=1` : `/api/sales/payments?customerId=${customer.id}`, { signal: c.signal })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setBalance(purchase ? (d?.balance != null ? Number(d.balance) : null) : d?.account ? Number(d.account.balance) : null)).catch(() => {});
    return () => c.abort();
  }, [customer, purchase, editBill, desk]);

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
    const next = rowFor(item, row, side);
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

  // ─── Stock strip (old T-Rim / Sheet / T-Sheet): stock in hand of the item in the row the cursor is in ───
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeItem = rows.find((r) => r.key === activeKey)?.item ?? null;
  const strip = (() => {
    if (!activeItem || activeItem.kind === "SERVICE") return null;
    const base = available(activeItem);
    const pack = activeItem.saleUnit && activeItem.saleUnit !== activeItem.baseUnit ? activeItem.units?.find((u) => u.code === activeItem.saleUnit) : undefined;
    const packs = pack ? Math.trunc(base / pack.factor) : null;
    return { name: activeItem.name, packs, loose: pack ? base - (packs ?? 0) * pack.factor : null, total: base, packCode: pack?.code ?? null, baseUnit: activeItem.baseUnit ?? "" };
  })();

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
  const net = purchase ? Math.round(totals.amount * 100) / 100 : Math.round(totals.amount);
  const receivedNow = received === "" ? (cashSale ? net : 0) : Math.min(num(received), net);
  const owedOnBill = net - receivedNow;

  // ─── Save ───
  const problem = (): string | null => {
    if (!filled.length) return "Add at least one item";
    if (!cashSale && !customer) return `Choose the ${party}`;
    if (cashSale && !walkInName.trim()) return "Enter the customer's name";
    for (const r of filled) {
      const name = r.item!.name;
      if (!(num(r.qty) > 0) && !(isPack(r) && num(r.loose) > 0)) return `${name}: enter the quantity`;
      if (asksSheets(r)) return `${name}: ${r.loose} loose sheets and no packets. Answer the question under the row`;
      if (isPack(r) && num(r.loose) >= factorOf(r)) return `${name}: loose sheets must be fewer than one ${r.unit} (${factorOf(r)})`;
      if (!(priceOf(r) > 0)) return `${name}: enter the price${isPaper(r) ? " or the rate per kg" : ""}`;
      if (!purchase && !isService(r) && sheetsOf(r) > available(r.item!)) return `${name}: only ${fmt(available(r.item!), 0)} ${r.item!.baseUnit ?? ""} in stock`;
    }
    if (received !== "" && num(received) > net) return "Received now is more than the bill";
    if (editing && reason.trim().length < 3) return "Give a reason for the change";
    return null;
  };

  const save = async () => {
    if (locked) return;
    const p = problem();
    if (p) { toast.error(p); return; }
    setSaving(true);
    try {
      const api = purchase ? "/api/purchases" : "/api/sales";
      const res = await fetch(editing ? `${api}/${editBill!.id}` : api, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          ...(purchase
            ? { supplierId: customer!.id, vendorBillNo: vendorBillNo.trim() || null, vendorBillDate: vendorBillDate || null, biltyNo: biltyNo.trim() || null, biltyDate: biltyDate || null, dueDate: editBill?.dueDate || null }
            : { customerId: cashSale ? null : customer!.id }),
          walkInName: cashSale ? walkInName.trim() : null,
          walkInPhone: cashSale ? walkInPhone.trim() || null : null,
          notes: notes.trim() || null,
          ...(isInvoiceEdit || (purchase && !(receivedNow > 0)) ? {} : { paidNow: { amount: String(receivedNow), method } }),
          ...(editing ? { reason: reason.trim() } : { requestId }),
          items: filled.map((r) => ({
            componentId: r.item!.id,
            quantity: num(r.qty),
            unit: r.unit || undefined,
            loose: isPack(r) && num(r.loose) > 0 ? num(r.loose) : undefined,
            unitPrice: String(priceOf(r)),
            paper: isPaper(r) ? { x: r.x, y: r.y, gsm: r.gsm, divisor: r.divisor || null, ratePerKg: r.rate || null } : undefined,
            remarks: r.remarks.trim() || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The bill was not saved");
      if (data.pending) {
        toast.success(`Saved on this computer as ${data.entry.provisionalRef ?? "a pending entry"}; it gets its number when it syncs`, { duration: 10000 });
        router.push(desk ? deskUrl("new=1") : "/dashboard/sales");
        return;
      }
      const savedBill = data.sale ?? data.purchase;
      toast.success(`Bill ${savedBill.docNo} saved`);
      const freed = (data.releasedCredit ?? []).reduce((t: number, c: { amount: string }) => t + Number(c.amount), 0);
      if (freed > 0) toast.info(`${money(freed)} already paid no longer fits this bill; it is now the customer's credit.`, { duration: 12000 });
      router.push(desk ? deskUrl(`id=${savedBill.id}`) : purchase ? `/dashboard/purchases/${savedBill.id}` : `/dashboard/sales/${savedBill.id}`);
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
    const type = purchase ? "PURCHASE_INVOICE" : cashSale ? "CASH_SALE" : "SALE_INVOICE";
    const res = await fetch(`/api/sales/step?type=${type}&dir=${dir}${editBill ? `&from=${editBill.id}` : ""}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || "Could not open the bill"); return; }
    if (!data.bill) { toast.info(dir === "next" ? "This is the last bill" : dir === "prev" ? "This is the first bill" : "No bills yet"); return; }
    router.push(desk ? deskUrl(`id=${data.bill.id}`) : `/dashboard/sales/${data.bill.id}`);
  };

  // ─── Desk: Find by number, Print / Print G, Cash Update, earlier cash bills by name (F1) ───
  const [findNo, setFindNo] = useState("");
  /** Bills found by name (or phone, or a number that is no bill number), to pick from */
  const [findHits, setFindHits] = useState<{ id: string; docNo: string; name: string; date: string; total: string; remaining: string; status: string }[] | null>(null);
  const kindName = purchase ? "supplier invoice" : cashSale ? "cash sale" : "invoice";
  const find = async () => {
    const type = purchase ? "PURCHASE_INVOICE" : cashSale ? "CASH_SALE" : "SALE_INVOICE";
    const q = findNo.trim();
    if (!q) { toast.error("Type a bill number or a name"); return; }
    // A plain number is first taken as the bill number (old Find)
    if (/^\d+$/.test(q)) {
      const data = await fetch(`/api/sales/step?type=${type}&number=${q}`).then((r) => r.json()).catch(() => ({}));
      if (data.bill) { setFindNo(""); setFindHits(null); router.push(deskUrl(`id=${data.bill.id}`)); return; }
    }
    // Otherwise the customer's, walk-in's or supplier's name, a phone number, a supplier bill number or an item
    const url = purchase ? `/api/purchases?search=${encodeURIComponent(q)}` : `/api/sales?type=${type}&search=${encodeURIComponent(q)}`;
    const data = await fetch(url).then((r) => r.json()).catch(() => ({}));
    const rows = ((data.rows ?? []) as { id: string; docNo: string; customer?: string; supplier?: string; date: string; total: string; remaining: string; status: string }[])
      .slice(0, 20).map((r) => ({ id: r.id, docNo: r.docNo, name: (purchase ? r.supplier : r.customer) ?? "", date: r.date, total: r.total, remaining: r.remaining, status: r.status }));
    if (!rows.length) { toast.error(`No ${kindName} found for "${q}"`); return; }
    setFindHits(rows);
    setTimeout(() => document.querySelector<HTMLButtonElement>("[data-find-hit]")?.focus(), 30);
  };
  const print = (layout: "invoice" | "slip") => {
    if (!editBill) return;
    window.open(`/api/${purchase ? "purchases" : "sales"}/${editBill.id}/pdf?inline=1${layout === "slip" ? "&layout=slip" : ""}`, "_blank", "noopener");
    // The print count and date on the screen follow once the file is made
    setTimeout(() => router.refresh(), 1500);
  };
  const [cashUpdate, setCashUpdate] = useState<null | { amount: string; method: string; busy: boolean }>(null);
  const [cashRequest, setCashRequest] = useState(() => crypto.randomUUID());
  const payLabel = purchase ? "Pay supplier" : cashSale ? "Cash Update" : "Receive payment";
  const sendCashUpdate = async () => {
    if (!editBill || !cashUpdate) return;
    setCashUpdate({ ...cashUpdate, busy: true });
    const date = new Date().toISOString().slice(0, 10);
    const amount = cashUpdate.amount;
    // A cash sale's walk-in has no customer record: its Cash Update goes through the bill itself (main server)
    const [url, body] = editBill.type === "CASH_SALE"
      ? [`/api/sales/${editBill.id}/cash-update`, { amount, method: cashUpdate.method, requestId: cashRequest }]
      : purchase
        ? ["/api/purchases/payments", { supplierId: editBill.customer?.id, date, amount, method: cashUpdate.method, allocations: [{ billId: editBill.id, amount }], requestId: cashRequest }]
        : ["/api/sales/payments", { customerId: editBill.customer?.id, date, amount, method: cashUpdate.method, allocations: [{ invoiceId: editBill.id, amount }], requestId: cashRequest }];
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || "The payment was not recorded"); setCashUpdate({ ...cashUpdate, busy: false }); return; }
    const doc = data.receipt ?? data.payment;
    toast.success(data.pending ? `${money(Number(amount))} kept on this computer; it reaches the office server when connected`
      : `${money(Number(amount))} ${purchase ? "paid" : "received"}${doc?.docNo ? ` as ${doc.docNo}` : ""}`);
    setCashUpdate(null);
    setCashRequest(crypto.randomUUID());
    router.refresh();
  };
  const [nameHits, setNameHits] = useState<{ id: string; docNo: string; customer: string; date: string; remaining: string }[] | null>(null);
  const findByName = async () => {
    const q = walkInName.trim();
    const data = await fetch(`/api/sales?type=CASH_SALE&search=${encodeURIComponent(q === "Cash sale" ? "" : q)}`).then((r) => r.json()).catch(() => ({}));
    setNameHits((data.rows ?? []).slice(0, 15));
  };

  const title = desk ? (purchase ? "Supplier Invoice" : cashSale ? "Cash Sale" : "Customer Invoice") + (editing ? " — editing" : "")
    : editing ? `Edit ${cashSale ? "cash sale" : "invoice"} ${editBill!.invoiceNumber}` : cashSale ? "Cash Sale" : "Customer Invoice";
  const unitLabel = (r: Row) => r.unit || r.item?.baseUnit || "";

  // ─── Layout ─────────────────────────────────────────────────────────
  const th = "px-2 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap";
  const thNum = `${th} text-right`;
  const cellInput = "h-8 px-2 text-right tabular-nums";
  const shown = "px-2 py-1 text-right tabular-nums whitespace-nowrap text-sm";

  return (
    // The desk is a window of its own, as the old program's, not the full page: centred, with a soft deep shadow
    <div className={cn("space-y-4", desk && "mx-auto max-w-6xl rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.06),0_18px_48px_-16px_rgba(15,23,42,.35)] ring-1 ring-black/[.04] sm:p-6 dark:border-border dark:shadow-[0_18px_48px_-16px_rgba(0,0,0,.8)] dark:ring-white/[.06]")} data-desk-window={desk ? "" : undefined}>
      <NewCustomerDialog
        open={newCustomerOpen}
        initialText={custQuery}
        onClose={() => setNewCustomerOpen(false)}
        onCreated={(c) => { setCustomer(c); setCustQuery(""); setNewCustomerOpen(false); }}
      />

      {/* Locked (a saved bill on the desk): every box keeps full contrast so the bill reads as printed */}
      <fieldset disabled={locked} className="m-0 min-w-0 space-y-4 border-0 p-0 [&_input:disabled]:cursor-default [&_input:disabled]:opacity-100 [&_select:disabled]:opacity-100 [&_button:disabled]:opacity-100">
      {/* Title row: which bill, its number and date, and the kind switch */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{locked ? "Saved bill. << < > >> and Find show other bills; Edit changes this one." : "Enter moves to the next box; at the end of a row it opens a new one. Ctrl+S saves."}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!editing && !desk && (
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
            <span className="font-semibold tabular-nums">{editBill ? editBill.invoiceNumber : "New"}</span>
          </div>
        </div>
      </div>

      {/* Customer and totals (old Cus-Id, Customer, Balance; T-Rim, Sheet, T-Sheet, Net Wait) */}
      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-2">
            {cashSale ? (
              <div className="grid max-w-xl gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <div className="relative space-y-1">
                  <Label htmlFor="walkin">Customer name <span className="font-normal text-muted-foreground">(F1: earlier bills)</span></Label>
                  <Input id="walkin" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="Cash sale"
                    onBlur={() => setTimeout(() => setNameHits(null), 200)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); document.getElementById("walkin-phone")?.focus(); }
                      // F1: earlier cash bills of this name (old Cash Sale)
                      else if (e.key === "F1") { e.preventDefault(); void findByName(); }
                      else if (e.key === "Escape") setNameHits(null);
                    }} />
                  {nameHits && (
                    <div role="listbox" aria-label="Earlier cash bills" className="absolute z-30 mt-1 max-h-64 w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-background shadow-lg">
                      {nameHits.length ? nameHits.map((h) => (
                        <button key={h.id} type="button" role="option" aria-selected={false} className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(e) => { e.preventDefault(); setNameHits(null); router.push(`/dashboard/sales/desk?kind=cash&id=${h.id}`); }}>
                          <span><span className="font-medium">{h.docNo}</span> · {h.customer}</span>
                          <span className="tabular-nums text-muted-foreground">{h.date.slice(0, 10)}{Number(h.remaining) > 0 ? ` · owes ${money(Number(h.remaining))}` : ""}</span>
                        </button>
                      )) : <p className="px-3 py-2 text-sm text-muted-foreground">No cash bills for this name</p>}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="walkin-phone">Cell No</Label>
                  <Input id="walkin-phone" inputMode="tel" value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value.slice(0, 40))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setFocusNext(`${rows[0].key}:item`); setRows((rs) => [...rs]); } }} />
                </div>
              </div>
            ) : customer ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">{purchase ? "Supplier" : "Customer"}</p>
                  <p className="font-semibold">{customer.name}{customer.phone && <span className="ml-2 text-sm font-normal text-muted-foreground">{customer.phone}</span>}</p>
                </div>
                {(editBill && desk ? desk.previousBalance != null : balance !== null) && (
                  <div>
                    <p className="text-xs text-muted-foreground">{purchase ? "Owed to them before this bill" : "Balance before this bill"}</p>
                    {/* A saved bill shows the balance stored with it; a new bill today's balance */}
                    <p className={cn("font-semibold tabular-nums", (editBill && desk ? Number(desk.previousBalance) : balance!) > 0 && "text-amber-700 dark:text-amber-400")}>{money(editBill && desk ? ((purchase ? -1 : 1) * Number(desk.previousBalance) || 0) : balance!)}</p>
                  </div>
                )}
                {!editBill && <Button type="button" variant="ghost" size="sm" onClick={() => { setCustomer(null); setBalance(null); }}>Change</Button>}
              </div>
            ) : (
              <div className="relative max-w-md space-y-1">
                <Label htmlFor="cust">{purchase ? "Supplier (number + Enter, F1 list)" : "Customer"}</Label>
                <Input
                  id="cust" autoFocus placeholder={purchase ? "Supplier number or name" : "Type the customer's name or phone"}
                  value={custQuery}
                  onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); }}
                  onFocus={() => setCustOpen(true)}
                  onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                  onKeyDown={(e) => {
                    // F1 opens the customer list (old program); a typed number + Enter picks that customer
                    if (e.key === "F1") { e.preventDefault(); setCustQuery(""); setCustOpen(true); return; }
                    if (e.key === "Enter" && custNo && !custList.some((c) => c.partyNo === custNo)) { e.preventDefault(); void pickCustomerNo(custNo); return; }
                    if (e.key === "Enter" && custList[0]) { e.preventDefault(); setCustomer(custList[0]); setCustQuery(""); setCustOpen(false); if (purchase) setTimeout(() => document.getElementById("s-inv")?.focus(), 50); else setFocusNext(`${rows[0].key}:item`); }
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
                    {!purchase && <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                      onMouseDown={(e) => { e.preventDefault(); setCustOpen(false); setNewCustomerOpen(true); }}>
                      <UserPlus className="h-4 w-4" aria-hidden /> {custQuery.trim() ? `New customer "${custQuery.trim()}"` : "New customer"}
                    </button>}
                  </div>
                )}
              </div>
            )}
          </div>
          {purchase && (
            <div className="grid gap-2 sm:grid-cols-4 lg:col-span-2">
              {([["s-inv", "S-Inv #", vendorBillNo, setVendorBillNo, "text"], ["s-inv-date", "Inv Date", vendorBillDate, setVendorBillDate, "date"], ["bl-no", "BL #", biltyNo, setBiltyNo, "text"], ["bl-date", "BL Date", biltyDate, setBiltyDate, "date"]] as const).map(([id, label, value, setter, kind], k, all) => (
                <div key={id} className="space-y-1">
                  <Label htmlFor={id} className="text-xs">{label}</Label>
                  <Input id={id} type={kind} className="h-9" value={value} maxLength={60} onChange={(e) => setter(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (all[k + 1]) document.getElementById(all[k + 1][0])?.focus(); else { setFocusNext(`${rows[0].key}:item`); setRows((rs) => [...rs]); } } }} />
                </div>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-sm sm:grid-cols-5" aria-label="Bill totals">
            {[
              ["Packets", fmt(totals.packets, 0)], ["Loose sheets", fmt(totals.loose, 0)], ["Total sheets", fmt(totals.sheets, 0)],
              ["Net weight", `${fmt(totals.weight, 2)} kg`], ["Net amount", money(net)],
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
      <div className="flex min-h-9 flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/30 px-3 py-1.5 text-sm" aria-live="polite" aria-label="Stock in hand of the item in this row">
        {strip ? (<>
          <span className="font-medium">{strip.name}</span>
          {strip.packCode && <span>T-Rim <strong className="tabular-nums">{fmt(strip.packs ?? 0, 0)}</strong> {strip.packCode}s</span>}
          {strip.packCode && <span>Sheet <strong className="tabular-nums">{fmt(strip.loose ?? 0, 3)}</strong></span>}
          <span>T-Sheet <strong className="tabular-nums">{fmt(strip.total, 3)}</strong> {strip.baseUnit}s in stock</span>
        </>) : <span className="text-muted-foreground">Stock in hand shows here for the item in the row you are on. F1 lists items · Esc on an item removes its row · F2 goes to the row&apos;s remarks.</span>}
      </div>
      <Card>
        <CardContent className="p-0">
          {/* relative: hidden screen-reader labels inside the grid are placed in this box, so they cannot widen the page */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1330px] border-collapse text-sm">
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
                  <th className={`${th} min-w-[140px]`}>Remarks</th>
                  <th className={`${th} w-10`}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody ref={grid}>
                {rows.map((r, i) => {
                  const kg = kgPerUnit(r);
                  const calc = calcPrice(r);
                  const pack = isPack(r);
                  const service = isService(r);
                  const short = !purchase && r.item && !service && sheetsOf(r) > available(r.item);
                  const open = searchRow === r.key;
                  const askN = !locked && asksSheets(r) ? num(r.loose) : 0;
                  const units = unitsFor(r);
                  return (
                    <Fragment key={r.key}>
                      <tr className={cn("border-b align-middle", short && "bg-destructive/5")} onFocusCapture={() => setActiveKey(r.key)}
                        onKeyDown={(e) => {
                          // F2 jumps to this row's remarks (old program)
                          if (e.key === "F2" && r.item) { e.preventDefault(); grid.current?.querySelector<HTMLInputElement>(`[data-cell="${r.key}:remarks"]`)?.focus(); }
                        }}>
                        <td className="px-2 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="relative px-2 py-1">
                          {r.item && !open ? (
                            <button type="button" data-cell={`${r.key}:item`}
                              className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => { setRow(r.key, { query: "" }); setSearchRow(r.key); setHighlight(0); setFocusNext(`${r.key}:item`); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); moveOn(e.currentTarget); }
                                else if (e.key === "Escape") { e.preventDefault(); const next = rows[i + 1]?.key; removeRow(r.key); if (next) setFocusNext(`${next}:item`); }
                              }}
                              title="Change the item (Esc removes the row)">
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
                            {r.item && units.length > 1 ? (
                              <select aria-label={`Unit, row ${i + 1}`} className="h-8 rounded-md border bg-background px-1 text-xs"
                                value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value, loose: "" })}>
                                {units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
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
                            onBlur={() => foldLoose(r.key)}
                            onChange={(e) => setRow(r.key, { loose: whole(e.target.value) })} />
                        </td>
                        <td className={shown}>{r.item && !service ? fmt(sheetsOf(r), 0) : ""}</td>
                        <td className={cn(shown, "font-semibold")}>{r.item ? fmt(amountOf(r), 2) : ""}</td>
                        <td className="px-1 py-1">
                          <Input data-cell={`${r.key}:remarks`} disabled={!r.item} className="h-8 w-36 px-2" aria-label={`Remarks, row ${i + 1}`}
                            value={r.remarks} maxLength={500} onKeyDown={onEnter} onChange={(e) => setRow(r.key, { remarks: e.target.value })} />
                        </td>
                        <td className="px-1 py-1 text-center">
                          {r.item && (
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r.key)}>
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                            </Button>
                          )}
                        </td>
                      </tr>
                      {short && (
                        <tr className="bg-destructive/5"><td /><td colSpan={15} className="px-2 pb-2 text-xs text-destructive">
                          Only {fmt(available(r.item!), 0)} {r.item!.baseUnit} in stock ({stockText(r.item!, available(r.item!))}).
                        </td></tr>
                      )}
                      {askN > 0 && (
                        <tr className="bg-amber-50 dark:bg-amber-950/30" data-sheets-ask={r.key}>
                          <td /><td colSpan={15} className="px-2 py-2 text-xs">
                            <div role="group" aria-label={`Row ${i + 1}: loose sheets and no packets`} className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-amber-900 dark:text-amber-200">
                                {fmt(askN, 0)} loose sheets of {r.item!.name} and no packets. Did you mean {fmt(askN, 0)} packets?
                              </span>
                              <Button type="button" size="sm" className="h-7" data-sheets-choice="packets" onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setRow(r.key, { qty: String(askN), loose: "", sheetsOk: true }); setFocusNext(`${r.key}:qty`); }}>
                                Yes: {fmt(askN, 0)} packets ({fmt(askN * factorOf(r), 0)} sheets)
                              </Button>
                              <Button type="button" size="sm" variant="ghost" className="h-7" data-sheets-choice="sheets" onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setRow(r.key, { sheetsOk: true })}>
                                No, {fmt(askN, 0)} loose sheets
                              </Button>
                            </div>
                          </td>
                        </tr>
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

      </fieldset>

      {/* Remarks, money and the old program's buttons */}
      <Card className="[&_input:disabled]:cursor-default [&_input:disabled]:opacity-100 [&_button:disabled]:opacity-100">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="remarks">Remarks</Label>
              <Input id="remarks" disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the bill" />
            </div>
            {editing && (
              <div className="space-y-1">
                <Label htmlFor="reason">Reason for the change *</Label>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer took 3 packets more" />
                <p className="text-xs text-muted-foreground">The bill keeps its number; the earlier version and this reason stay in its history.</p>
              </div>
            )}
          </div>
          {desk && editBill ? (
            <PaymentPanel desk={desk} money={money} purchase={purchase} cashSale={cashSale} editing={editing} payLabel={payLabel}
              onPay={() => setCashUpdate({ amount: String(Number(desk.remaining ?? 0) || ""), method: "CASH", busy: false })} />
          ) : (
          <div className="space-y-2">
            {isInvoiceEdit ? (
              <p className="text-sm text-muted-foreground">Payments already received stay with this bill. Receive more from the bill page.</p>
            ) : (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="received">{purchase ? "Paid now" : cashSale ? "Cash received" : "Received now"}</Label>
                  <Input id="received" disabled={locked} inputMode="decimal" className="tabular-nums" value={received === "" ? String(receivedNow) : received}
                    onFocus={(e) => e.target.select()} onChange={(e) => setReceived(decimal(e.target.value, 2))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("save-bill")?.focus(); } }} />
                </div>
                <Select value={method} disabled={locked} onChange={(v: string) => setMethod(v)}>
                  <SelectTrigger className="w-36" aria-label="Paid by"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Net amount</dt><dd className="font-semibold tabular-nums">{money(net)}</dd></div>
              {!isInvoiceEdit && <div className="flex justify-between"><dt className="text-muted-foreground">Left to pay on this bill</dt><dd className="tabular-nums">{money(owedOnBill)}</dd></div>}
              {!cashSale && !editBill && balance !== null && (
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">{purchase ? "Owed to them after this bill" : <>Customer&apos;s balance after this bill</>}</dt><dd className="font-semibold tabular-nums">{money(balance + owedOnBill)}</dd></div>
              )}
              {!cashSale && editBill && locked && desk?.newBalance != null && (
                <div className="flex justify-between border-t pt-1"><dt className="text-muted-foreground">{purchase ? "Owed to them after this bill" : <>Customer&apos;s balance after this bill</>}</dt><dd className="font-semibold tabular-nums">{money((purchase ? -1 : 1) * Number(desk.newBalance) || 0)}</dd></div>
              )}
            </dl>
          </div>
          )}
          {!desk && <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 lg:col-span-2">
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
          </div>}
        </CardContent>
      </Card>

      {desk && (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur" role="toolbar" aria-label="Invoice desk">
          <div className="flex flex-wrap items-center gap-1">
            {([["first", ChevronFirst, "First bill"], ["prev", ChevronLeft, "Previous bill"], ["next", ChevronRight, "Next bill"], ["last", ChevronLast, "Last bill"]] as const).map(([d, Icon, label]) => (
              <Button key={d} type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={label} title={label} disabled={!locked && !!editBill} onClick={() => step(d)}>
                <Icon className="h-4 w-4" aria-hidden />
              </Button>
            ))}
            <div className="relative ml-1 flex items-center gap-1">
              <Input aria-label="Find bill by number or name" placeholder={purchase ? "Bill no or supplier" : "Bill no or name"} className="h-9 w-44" value={findNo}
                title="A bill number, or a name or phone number: matching bills are listed"
                onChange={(e) => { setFindNo(e.target.value.slice(0, 80)); setFindHits(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } else if (e.key === "Escape") setFindHits(null); }} />
              <Button type="button" variant="outline" className="h-9 gap-1" onClick={() => void find()}><Search className="h-4 w-4" aria-hidden /> Find</Button>
              {findHits && (
                <div role="listbox" aria-label="Bills found" data-find-list
                  className="absolute bottom-full left-0 z-40 mb-2 max-h-80 w-[30rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-sky-200 bg-background shadow-xl dark:border-sky-900"
                  onKeyDown={(e) => {
                    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-find-hit]")];
                    const at = items.indexOf(document.activeElement as HTMLButtonElement);
                    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(at + 1, items.length - 1)]?.focus(); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(at - 1, 0)]?.focus(); }
                    else if (e.key === "Escape") { e.preventDefault(); setFindHits(null); }
                  }}>
                  <p className="sticky top-0 border-b bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                    {findHits.length} {kindName}{findHits.length === 1 ? "" : "s"} for “{findNo.trim()}” · arrow keys and Enter
                  </p>
                  {findHits.map((h) => {
                    const owed = Number(h.remaining), cancelled = h.status !== "POSTED";
                    return (
                      <button key={h.id} type="button" role="option" aria-selected={false} data-find-hit
                        className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted focus:bg-muted focus:outline-none"
                        onClick={() => { setFindHits(null); setFindNo(""); router.push(deskUrl(`id=${h.id}`)); }}>
                        <span className="min-w-0">
                          <span className="font-semibold">{h.docNo}</span> <span className="text-muted-foreground">· {h.date.slice(0, 10)}</span>
                          <span className="block truncate">{h.name || "-"}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="tabular-nums font-medium">{money(Number(h.total))}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            cancelled ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              : owed > 0 ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300")}>
                            {cancelled ? (h.status === "CANCELLED" ? "Cancelled" : "Replaced") : owed > 0 ? `${purchase ? "You owe" : "Owes"} ${money(owed)}` : "Paid"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {editBill && locked && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {desk.status === "CANCELLED" ? "Cancelled · " : ""}Printed {desk.printCount ?? 0} time{desk.printCount === 1 ? "" : "s"}{desk.lastPrintedAt ? `, last ${new Date(desk.lastPrintedAt).toLocaleString("en-PK")}` : ""}
              {Number(desk.remaining ?? 0) > 0 ? ` · ${purchase ? "you owe" : "owes"} ${money(Number(desk.remaining))}` : ""}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {locked ? (<>
              {desk.canNew !== false && <Button type="button" variant="outline" className="gap-1" onClick={() => router.push(deskUrl("new=1"))}><FilePlus2 className="h-4 w-4" aria-hidden /> New</Button>}
              {desk.canEdit && <Button type="button" variant="outline" className="gap-1" onClick={() => { setLocked(false); setTimeout(() => document.getElementById("reason")?.focus(), 50); }}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>}
              {(desk.canPay || desk.canCashUpdate) && <Button type="button" variant="outline" className="gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40" onClick={() => setCashUpdate({ amount: String(Number(desk.remaining ?? 0) || ""), method: "CASH", busy: false })}><Banknote className="h-4 w-4" aria-hidden /> {payLabel}</Button>}
              <Button type="button" variant="outline" className="gap-1" onClick={() => print("invoice")}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
              {!purchase && <Button type="button" variant="outline" className="gap-1" onClick={() => print("slip")} title="The slip (old Print G)"><Receipt className="h-4 w-4" aria-hidden /> Print G</Button>}
            </>) : (<>
              <Button type="button" variant="outline" className="gap-1" disabled={saving} // Cancel throws the unsaved changes away: the saved bill is loaded again, locked
                onClick={() => window.location.assign(editBill ? deskUrl(`id=${editBill.id}`) : deskUrl(""))}
                aria-label="Cancel"><X className="h-4 w-4" aria-hidden /> Cancel</Button>
              <Button id="save-bill" type="button" className="gap-1" onClick={save} disabled={saving}><Save className="h-4 w-4" aria-hidden /> {saving ? "Saving..." : editing ? "Save changes" : "Save bill"}</Button>
            </>)}
          </div>
        </div>
      )}

      <Dialog open={!!cashUpdate} onClose={() => !cashUpdate?.busy && setCashUpdate(null)}>
        {cashUpdate && (<>
          <DialogHeader>
            <DialogTitle>{payLabel} · {editBill?.invoiceNumber}</DialogTitle>
            <DialogDescription>
              {purchase ? `Money paid to ${editBill?.customer?.name ?? "the supplier"} for this bill. It is kept as a payment voucher set against the bill.`
                : `Money received${cashSale ? "" : ` from ${editBill?.customer?.name ?? "the customer"}`} for this bill. It is kept as a receipt set against the bill.`}
              {" "}The bill itself stays as saved. Still owed: {money(Number(desk?.remaining ?? 0))}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2 py-2">
            <div className="space-y-1">
              <Label htmlFor="cash-update-amount">{purchase ? "Amount paid" : "Amount received"}</Label>
              <Input id="cash-update-amount" autoFocus inputMode="decimal" className="tabular-nums" value={cashUpdate.amount}
                onChange={(e) => setCashUpdate({ ...cashUpdate, amount: decimal(e.target.value, 2) })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sendCashUpdate(); } }} />
            </div>
            <Select value={cashUpdate.method} onChange={(v: string) => setCashUpdate({ ...cashUpdate, method: v })}>
              <SelectTrigger className="w-36" aria-label={purchase ? "Paid from" : "Received into"}><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashUpdate(null)} disabled={cashUpdate.busy}>Cancel</Button>
            <Button onClick={() => void sendCashUpdate()} disabled={cashUpdate.busy || !(Number(cashUpdate.amount) > 0)}>{cashUpdate.busy ? "Saving…" : purchase ? "Record payment" : cashSale ? "Record cash" : "Record receipt"}</Button>
          </DialogFooter>
        </>)}
      </Dialog>
    </div>
  );
}

/** A saved bill's money on the desk: the bill, what is paid, what is still owed, each payment, and the payment button. */
function PaymentPanel({ desk, money, purchase, cashSale, editing, payLabel, onPay }: {
  desk: DeskInfo; money: (n: number) => string; purchase: boolean; cashSale: boolean; editing: boolean; payLabel: string; onPay: () => void;
}) {
  const total = Number(desk.total ?? 0), paid = Number(desk.paid ?? 0), owed = Number(desk.remaining ?? 0);
  const cancelled = desk.status && desk.status !== "POSTED";
  const pct = total > 0 ? Math.min(100, Math.round(((total - owed) / total) * 100)) : 0;
  const state = cancelled ? { text: desk.status === "CANCELLED" ? "Cancelled" : "Replaced", cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" }
    : owed <= 0 ? { text: "Paid in full", cls: "bg-emerald-600 text-white" }
    : owed < total ? { text: "Part paid", cls: "bg-amber-500 text-white" }
    : { text: "Not paid yet", cls: "bg-rose-600 text-white" };
  const tile = "rounded-lg border px-3 py-2";
  return (
    <section aria-label="Payment" data-payment-panel
      className="space-y-3 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-3 dark:border-sky-900 dark:from-sky-950/50 dark:via-background dark:to-emerald-950/40">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{purchase ? "Payment to the supplier" : cashSale ? "Cash for this sale" : "Payment from the customer"}</h3>
        <span data-payment-state className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", state.cls)}>{state.text}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={cn(tile, "border-sky-200 bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/60")}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300">Bill</div>
          <div data-pay="total" className="font-semibold tabular-nums text-sky-950 dark:text-sky-100">{money(total)}</div>
        </div>
        <div className={cn(tile, "border-emerald-200 bg-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/60")}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Paid</div>
          <div data-pay="paid" className="font-semibold tabular-nums text-emerald-950 dark:text-emerald-100">{money(paid)}</div>
        </div>
        <div className={cn(tile, owed > 0 ? "border-rose-200 bg-rose-100/70 dark:border-rose-900 dark:bg-rose-950/60" : "border-emerald-200 bg-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/60")}>
          <div className={cn("text-[11px] font-medium uppercase tracking-wide", owed > 0 ? "text-rose-800 dark:text-rose-300" : "text-emerald-800 dark:text-emerald-300")}>{purchase ? "You owe" : "Still owed"}</div>
          <div data-pay="owed" className={cn("flex items-center justify-center gap-1 font-semibold tabular-nums", owed > 0 ? "text-rose-950 dark:text-rose-100" : "text-emerald-950 dark:text-emerald-100")}>
            {owed <= 0 && <CheckCircle2 className="h-4 w-4" aria-hidden />}{money(owed)}
          </div>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-rose-200 dark:bg-rose-950" role="progressbar" aria-label="Paid so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {(desk.payments?.length ?? 0) > 0 && (
        <ul className="space-y-1 text-xs" aria-label="Payments on this bill">
          {desk.payments!.map((p, i) => (
            <li key={`${p.docNo}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="truncate">{p.date.slice(0, 10)} · {p.docNo} · {p.method}</span>
              </span>
              <span className="font-medium tabular-nums">{money(Number(p.amount))}</span>
            </li>
          ))}
        </ul>
      )}
      {!cashSale && desk.newBalance != null && (
        <div className="flex items-center justify-between rounded-lg bg-violet-100/70 px-3 py-1.5 text-sm dark:bg-violet-950/50">
          <span className="text-violet-900 dark:text-violet-200">{purchase ? "Owed to them after this bill" : "Customer's balance after this bill"}</span>
          <span className="font-semibold tabular-nums text-violet-950 dark:text-violet-100">{money((purchase ? -1 : 1) * Number(desk.newBalance) || 0)}</span>
        </div>
      )}
      {editing ? (
        <p className="text-xs text-muted-foreground">Payments already made stay with this bill. Receive or pay more after saving.</p>
      ) : (desk.canPay || desk.canCashUpdate) && owed > 0 ? (
        <Button type="button" data-pay-button onClick={onPay} className="h-10 w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
          <Banknote className="h-4 w-4" aria-hidden /> {payLabel} · {money(owed)}
        </Button>
      ) : desk.payNote && owed > 0 ? (
        <p data-pay-note className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{desk.payNote}</p>
      ) : null}
    </section>
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
