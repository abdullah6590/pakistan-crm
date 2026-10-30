"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Save, ShoppingCart, Package,
  Search, X, User, Phone, Banknote, Smartphone,
  Receipt, Percent, Calculator, Minus, AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import PriceCalculator, { type PriceCalcValues, defaultCalcValues } from "@/components/shared/price-calculator";
import { NewCustomerDialog } from "@/components/shared/new-customer-dialog";

// ─── Types ──────────────────────────────────────────────────────────
interface ComponentOption {
  id: string; name: string; sku: string; quantity: number;
  unitCost: number; unitPrice: number; minQuantity: number;
  description?: string; location?: string;
  category?: { name: string } | null;
  supplier?: { name: string } | null;
  dimensionX?: number | null; dimensionY?: number | null;
  gsm?: number | null; divisor?: number | null;
  weightKg?: number | null; rimInSheet?: number | null;
  ratePerKg?: number | null;
  /** Units the item is sold in (Books item units): the stock unit and pack units with their size in stock units */
  baseUnit?: string; saleUnit?: string;
  units?: { code: string; factor: number }[];
}

interface CustomerOption { id: string; name: string; phone: string; }

interface CartItem {
  componentId: string;
  componentName: string;
  sku: string;
  /** Quantity in `unit`; `loose` adds stock units to a pack unit (2 packets + 30 sheets) */
  quantity: number;
  unit: string;
  loose: number;
  looseText?: string;
  unitCost: number;
  unitPrice: number;
  availableStock: number;
  compData: ComponentOption; // store for calc
  // What is in the box while it is being typed (empty is allowed until the box is left)
  qtyText?: string;
  priceText?: string;
}

/** Digits only, without leading zeros ("027" -> "27"); empty stays empty while typing. */
const cleanWhole = (text: string) => text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
/** A money amount as typed: digits and one decimal point, without leading zeros ("027" -> "27", "0.5" stays). */
const cleanDecimal = (text: string) => {
  const [whole, ...rest] = text.replace(/[^\d.]/g, "").split(".");
  const w = whole.replace(/^0+(?=\d)/, "");
  return rest.length ? `${w || "0"}.${rest.join("").slice(0, 2)}` : w;
};
/** Clicking into a box selects what is there, so typing replaces the 0 or 1 instead of adding to it. */
const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

const stockUnit = (comp: ComponentOption) => comp.baseUnit ?? "units";
/** True when the line is entered in a pack unit (packet, carton, ...) rather than the stock unit. */
const isPack = (item: Pick<CartItem, "unit" | "compData">) => !!item.compData.baseUnit && item.unit !== item.compData.baseUnit;
/** Stock units in one of the line's unit. */
const factorOf = (item: Pick<CartItem, "unit" | "compData">) => item.compData.units?.find((u) => u.code === item.unit)?.factor ?? 1;
/** The line's quantity in stock units: whole units times their size, plus loose stock units. */
const baseOf = (item: CartItem) => item.quantity * factorOf(item) + (isPack(item) ? item.loose : 0);
/** As Books prices it: whole units at their price, loose stock units at the price divided by the pack size. */
const lineAmount = (item: CartItem) => item.unitPrice * item.quantity + (isPack(item) && item.loose ? (item.unitPrice / factorOf(item)) * item.loose : 0);

/** A saved bill being corrected (edit mode). */
interface EditSaleData {
  id: string;
  invoiceNumber: string;
  /** SALE_INVOICE (a customer's bill) or CASH_SALE (walk-in); an edit keeps the kind of bill */
  type: string;
  customer: CustomerOption | null;
  walkInName: string | null;
  /** Cash sale: amount received with it */
  amountReceived: string | null;
  notes: string | null;
  items: { quantity: number; unit?: string; loose?: number; baseQuantity?: number; unitPrice: number; unitCost: number; component: ComponentOption }[];
}

interface Props {
  initialComponents: ComponentOption[];
  initialCustomers: CustomerOption[];
  editSale?: EditSaleData;
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  CASH: Banknote, BANK_TRANSFER: Banknote,
  JAZZCASH: Smartphone, EASYPAISA: Smartphone,
  NAYAPAY: Smartphone, SADAPAY: Smartphone,
};

export default function NewSaleClient({ initialComponents, initialCustomers, editSale }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const editing = !!editSale;

  // Stock already on the bill being edited goes back to stock when it is saved, so it is available to this bill
  const onBill = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of editSale?.items ?? []) m.set(i.component.id, (m.get(i.component.id) ?? 0) + (i.baseQuantity ?? i.quantity));
    return m;
  }, [editSale]);
  const available = (comp: ComponentOption) => comp.quantity + (onBill.get(comp.id) ?? 0);

  // Form state
  const [customerType, setCustomerType] = useState<"existing" | "walkin">(editSale && !editSale.customer ? "walkin" : "existing");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(editSale?.customer ?? null);

  const [walkInName, setWalkInName] = useState(editSale?.walkInName ?? "");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  // Money received now: "" means the full total (the default); a customer's bill may be paid in part or later
  const [paidNow, setPaidNow] = useState(editSale?.amountReceived ?? "");
  const [notes, setNotes] = useState(editSale?.notes ?? "");
  const [reason, setReason] = useState("");
  // One id per form: a double click or a retry after a lost answer cannot make a second bill
  const [requestId] = useState(() => crypto.randomUUID());
  const isInvoiceEdit = editing && editSale!.type === "SALE_INVOICE";

  // Cart
  const [cart, setCart] = useState<CartItem[]>(() => (editSale?.items ?? []).map((i) => ({
    componentId: i.component.id,
    componentName: i.component.name,
    sku: i.component.sku,
    quantity: i.quantity,
    unit: i.unit ?? i.component.baseUnit ?? "",
    loose: i.loose ?? 0,
    unitCost: i.unitCost,
    unitPrice: i.unitPrice,
    availableStock: available(i.component),
    compData: i.component,
  })));

  // ─── Component Search State ───
  const [searchQuery, setSearchQuery] = useState("");
  // Results of the last search, kept with the query they belong to; the list shown is worked out from them
  const [componentsResults, setComponentsResults] = useState<{ q: string; items: ComponentOption[] } | null>(null);
  const searchQueryLength = searchQuery.trim().length;
  const filteredComponents = searchQueryLength === 0 ? initialComponents : searchQueryLength < 2 ? [] : componentsResults?.q === searchQuery ? componentsResults.items : [];
  const isSearchingComponents = searchQueryLength >= 2 && componentsResults?.q !== searchQuery;
  // The product list is open only while searching; it closes when a product is picked, on Escape, or on leaving
  // the box, so it never covers the quantity and price of the lines below
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // ─── Customer Search State ───
  const [custSearchQuery, setCustSearchQuery] = useState("");
  // Results of the last search, kept with the query they belong to; the list shown is worked out from them
  const [customersResults, setCustomersResults] = useState<{ q: string; items: CustomerOption[] } | null>(null);
  const custSearchQueryLength = custSearchQuery.trim().length;
  const filteredCustomers = custSearchQueryLength === 0 ? initialCustomers : custSearchQueryLength < 2 ? [] : customersResults?.q === custSearchQuery ? customersResults.items : [];
  const isSearchingCustomers = custSearchQueryLength >= 2 && customersResults?.q !== custSearchQuery;
  const [showCustDropdown, setShowCustDropdown] = useState(false);
  // "Create new customer" from the search box; the key gives each opening a fresh form
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerKey, setNewCustomerKey] = useState(0);
  const openNewCustomer = () => {
    setShowCustDropdown(false);
    setNewCustomerKey((k) => k + 1);
    setNewCustomerOpen(true);
  };

  const [expandedCalcIndex, setExpandedCalcIndex] = useState<number | null>(null);
  const [cartCalcValues, setCartCalcValues] = useState<Record<number, PriceCalcValues>>({});

  // ─── Async Component Search ───
  useEffect(() => {
    if (searchQuery.trim().length < 2) return;
    const controller = new AbortController();

    const fetchComponents = async () => {
      try {
        const res = await fetch(`/api/search/components?q=${encodeURIComponent(searchQuery)}&limit=10`, {
          signal: controller.signal
        });
        const data = await res.json();
        setComponentsResults({ q: searchQuery, items: data.data ?? [] });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error(err);
        setComponentsResults({ q: searchQuery, items: [] });
      }
    };

    const timer = setTimeout(fetchComponents, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery]);

  // ─── Async Customer Search ───
  useEffect(() => {
    if (custSearchQuery.trim().length < 2) return;
    const controller = new AbortController();

    const fetchCustomers = async () => {
      try {
        const res = await fetch(`/api/search/customers?q=${encodeURIComponent(custSearchQuery)}&limit=10`, {
          signal: controller.signal
        });
        const data = await res.json();
        setCustomersResults({ q: custSearchQuery, items: data.data ?? [] });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error(err);
        setCustomersResults({ q: custSearchQuery, items: [] });
      }
    };

    const timer = setTimeout(fetchCustomers, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [custSearchQuery]);

  const addToCart = (comp: ComponentOption) => {
    setShowProductDropdown(false);
    const stockForBill = available(comp);
    const existing = cart.find(c => c.componentId === comp.id);
    if (existing) {
      if (baseOf(existing) + factorOf(existing) > stockForBill) {
        toast.error(`Only ${stockForBill} ${stockUnit(comp)} in stock`);
        return;
      }
      setCart(cart.map(c =>
        c.componentId === comp.id ? { ...c, quantity: c.quantity + 1, qtyText: undefined } : c
      ));
    } else {
      if (stockForBill <= 0) {
        toast.error(`${comp.name} is out of stock`);
        return;
      }
      setCart([...cart, {
        componentId: comp.id,
        componentName: comp.name,
        sku: comp.sku,
        quantity: 1,
        unit: comp.saleUnit ?? comp.baseUnit ?? "",
        loose: 0,
        unitCost: comp.unitCost,
        unitPrice: comp.unitPrice,
        availableStock: stockForBill,
        compData: comp,
      }]);
    }
    setSearchQuery("");
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  // While typing, the box may be empty or above the stock; the line shows a warning and the bill cannot be
  // saved until it is corrected. Leaving an empty quantity box puts 1 back.
  const updateCartQty = (index: number, qty: string) => {
    const text = cleanWhole(qty);
    const updated = [...cart];
    updated[index] = { ...updated[index], quantity: parseInt(text, 10) || 0, qtyText: text };
    setCart(updated);
  };
  const finishCartQty = (index: number) => {
    const updated = [...cart];
    updated[index] = { ...updated[index], quantity: Math.max(1, updated[index].quantity), qtyText: undefined };
    setCart(updated);
  };

  // A different unit changes what the quantity and price mean; the price is not converted, so check it
  const updateCartUnit = (index: number, unit: string) => {
    const updated = [...cart];
    updated[index] = { ...updated[index], unit, loose: 0, looseText: undefined };
    setCart(updated);
  };
  const updateCartLoose = (index: number, loose: string) => {
    const text = cleanWhole(loose);
    const updated = [...cart];
    updated[index] = { ...updated[index], loose: parseInt(text, 10) || 0, looseText: text };
    setCart(updated);
  };

  const updateCartPrice = (index: number, price: string) => {
    const text = cleanDecimal(price);
    const updated = [...cart];
    updated[index] = { ...updated[index], unitPrice: parseFloat(text) || 0, priceText: text };
    setCart(updated);
  };
  const finishCartPrice = (index: number) => {
    const updated = [...cart];
    updated[index] = { ...updated[index], priceText: undefined };
    setCart(updated);
  };

  // ─── Totals ─────────────────────────────────────────────────────────
  const subtotal = cart.reduce((sum, item) => sum + lineAmount(item), 0);
  const total = subtotal;
  const paidAmount = paidNow === "" ? total : Math.min(parseFloat(paidNow) || 0, total);
  const totalProfit = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity - item.unitCost * baseOf(item), 0);

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error("Add at least one component to the sale"); return; }
    const short = cart.find(item => baseOf(item) > item.availableStock);
    if (short) { toast.error(`Only ${short.availableStock} ${stockUnit(short.compData)} of ${short.componentName} in stock`); return; }
    const tooLoose = cart.find(item => isPack(item) && item.loose >= factorOf(item));
    if (tooLoose) { toast.error(`${tooLoose.componentName}: loose ${stockUnit(tooLoose.compData)} must be fewer than one ${tooLoose.unit}`); return; }
    if (cart.some(item => item.quantity < 1)) { toast.error("Enter a quantity for every item"); return; }
    if (customerType === "existing" && !selectedCustomer) { toast.error("Select a customer"); return; }
    if (customerType === "walkin" && !walkInName.trim()) { toast.error("Enter customer name"); return; }
    if (editing && reason.trim().length < 3) { toast.error("Give a reason for the change"); return; }
    if (paidNow !== "" && (parseFloat(paidNow) || 0) > total) { toast.error("Paid now is more than the bill total"); return; }

    setLoading(true);
    try {
      const res = await fetch(editing ? `/api/sales/${editSale!.id}` : "/api/sales", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerType === "existing" && selectedCustomer ? selectedCustomer.id : null,
          walkInName: customerType === "walkin" ? walkInName.trim() : null,
          notes: notes.trim() || null,
          // A customer's bill being edited keeps its payments; they are managed on the bill page
          ...(isInvoiceEdit ? {} : { paidNow: { amount: String(paidAmount), method: paymentMethod } }),
          ...(editing ? { reason: reason.trim() } : { requestId }),
          items: cart.map(item => ({
            componentId: item.componentId,
            quantity: item.quantity,
            unit: item.unit || undefined,
            loose: isPack(item) && item.loose > 0 ? item.loose : undefined,
            unitPrice: item.unitPrice,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (editing ? "Failed to save the bill" : "Failed to create sale"));
      // Working from this computer's copy: queued for the main server
      if (data.pending) { toast.success(`Saved on this computer as ${data.entry.provisionalRef ?? "a pending entry"}; it gets its number when it syncs with the main server`, { duration: 10000 }); router.push("/dashboard/sales"); return; }
      if (editing) {
        toast.success(`Bill saved as ${data.sale.docNo}`);
        const freed = (data.releasedCredit ?? []).reduce((t: number, c: { amount: string }) => t + Number(c.amount), 0);
        if (freed > 0) toast.info(`${formatCurrency(freed)} already paid no longer fits this bill. It is now the customer's credit: apply it to another bill or refund it from Receive payment.`, { duration: 12000 });
      } else {
        toast.success(`Bill ${data.sale.docNo} saved`);
      }
      router.push(`/dashboard/sales/${data.sale.id}`);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <NewCustomerDialog
        key={newCustomerKey}
        open={newCustomerOpen}
        initialText={custSearchQuery}
        onClose={() => setNewCustomerOpen(false)}
        onCreated={(c) => {
          setSelectedCustomer(c);
          setCustomerType("existing");
          setCustSearchQuery("");
          setNewCustomerOpen(false);
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{editing ? `Edit Bill ${editSale!.invoiceNumber}` : "New Sale"}</h1>
            <p className="text-sm text-muted-foreground">
              {editing ? "Correct the bill; stock, the customer's balance and Finance are corrected with it" : "Record a component sale — walk-in or registered customer"}
            </p>
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={loading || cart.length === 0} className="gap-2">
          {loading ? <Calculator className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {loading ? "Saving..." : editing ? "Save Changes" : "Complete Sale"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Left Column: Cart & Customer ── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Customer Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" /> Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={customerType === "existing" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCustomerType("existing")}
                  disabled={editing && customerType !== "existing"}
                >
                  Registered
                </Button>
                <Button
                  variant={customerType === "walkin" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCustomerType("walkin")}
                  disabled={editing && customerType !== "walkin"}
                >
                  Walk-in
                </Button>
              </div>

              {customerType === "existing" ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Label className="mb-2 block">Search Customer</Label>
                    {!selectedCustomer ? (
                      <>
                        <Input
                          placeholder="Search by name or phone..."
                          value={custSearchQuery}
                          onChange={e => {
                            setCustSearchQuery(e.target.value);
                            setShowCustDropdown(true);
                          }}
                          onFocus={() => setShowCustDropdown(true)}
                          onBlur={() => setTimeout(() => setShowCustDropdown(false), 200)}
                        />
                        {isSearchingCustomers && <div className="absolute right-3 top-9 text-xs text-muted-foreground">Searching...</div>}

                        {showCustDropdown && (
                          <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background shadow-lg max-h-60 overflow-y-auto">
                            {filteredCustomers.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-muted transition-colors border-b"
                                onMouseDown={(e) => {
                                  e.preventDefault(); // prevent blur
                                  setSelectedCustomer(c);
                                  setShowCustDropdown(false);
                                  setCustSearchQuery("");
                                }}
                              >
                                <span className="text-sm font-medium">{c.name}</span>
                                {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                              </button>
                            ))}
                            {custSearchQuery.trim() !== "" && filteredCustomers.length === 0 && !isSearchingCustomers && (
                              <div className="px-3 py-2 text-sm text-muted-foreground border-b">No customer found.</div>
                            )}
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-muted transition-colors"
                              onMouseDown={(e) => { e.preventDefault(); openNewCustomer(); }}
                            >
                              <Plus className="h-4 w-4" />
                              {custSearchQuery.trim() ? `Create new customer "${custSearchQuery.trim()}"` : "Create new customer"}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
                        <div>
                          <p className="text-sm font-medium">{selectedCustomer.name}</p>
                          {selectedCustomer.phone && <p className="text-xs text-muted-foreground">{selectedCustomer.phone}</p>}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)}>
                          Change
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Customer Name *</Label>
                    <Input placeholder="e.g. Ali Khan" value={walkInName} onChange={e => setWalkInName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Phone (optional)</Label>
                    <Input placeholder="03XX-XXXXXXX" value={walkInPhone} onChange={e => setWalkInPhone(e.target.value)} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cart Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-4 w-4" /> Cart ({cart.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Component Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products by name or SKU..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setShowProductDropdown(true); }}
                  onFocus={() => setShowProductDropdown(true)}
                  onBlur={() => setTimeout(() => setShowProductDropdown(false), 150)}
                  onKeyDown={e => { if (e.key === "Escape") setShowProductDropdown(false); }}
                />
                {isSearchingComponents && <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Searching...</div>}

                {showProductDropdown && searchQuery.trim() !== "" && filteredComponents.length === 0 && !isSearchingComponents && (
                  <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background p-4 text-center text-sm text-muted-foreground shadow-lg">
                    No products found.
                  </div>
                )}

                {showProductDropdown && filteredComponents.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background shadow-lg max-h-60 overflow-y-auto">
                    {filteredComponents.map(comp => (
                      <button
                        key={comp.id}
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted transition-colors border-b last:border-0"
                        onMouseDown={(e) => e.preventDefault()} // keep the box focused until the click lands
                        onClick={() => addToCart(comp)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{comp.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {comp.sku} · Stock: {available(comp)} {comp.baseUnit ?? ""} · {formatCurrency(comp.unitPrice)}
                          </p>
                        </div>
                        <Plus className="h-4 w-4 ml-2 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No items added yet</p>
                  <p className="text-xs">Search above to Add Products</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((item, i) => (
                    <div key={`${item.componentId}-${i}`} className="space-y-0">
                      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-muted/30">
                        <div className="flex-1 min-w-[10rem]">
                          <p className="text-sm font-medium truncate">{item.componentName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.sku} · Stock: {item.availableStock} {item.compData.baseUnit ?? ""} · Cost: {formatCurrency(item.unitCost)}
                            {isPack(item) && ` · 1 ${item.unit} = ${factorOf(item)} ${item.compData.baseUnit}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
                          <div className="space-y-1">
                            <Input
                              type="text"
                              inputMode="numeric"
                              aria-label="Quantity"
                              className={`w-16 h-8 text-center text-xs ${baseOf(item) > item.availableStock ? "border-destructive text-destructive" : ""}`}
                              value={item.qtyText ?? String(item.quantity)}
                              onFocus={selectAll}
                              onChange={e => updateCartQty(i, e.target.value)}
                              onBlur={() => finishCartQty(i)}
                            />
                          </div>
                          {(item.compData.units?.length ?? 0) > 1 ? (
                            <select
                              aria-label="Unit"
                              className="h-8 rounded-md border border-input bg-background px-1 text-xs"
                              value={item.unit}
                              onChange={e => updateCartUnit(i, e.target.value)}
                            >
                              {item.compData.units!.map(u => <option key={u.code} value={u.code}>{u.code}</option>)}
                            </select>
                          ) : item.unit ? <span className="text-xs text-muted-foreground">{item.unit}</span> : null}
                          {isPack(item) && (
                            <Input
                              type="text"
                              inputMode="numeric"
                              aria-label={`Loose ${item.compData.baseUnit}`}
                              title={`Loose ${item.compData.baseUnit} on top of whole ${item.unit}s`}
                              placeholder={`+ ${item.compData.baseUnit}`}
                              className="w-16 h-8 text-center text-xs"
                              value={item.looseText ?? (item.loose ? String(item.loose) : "")}
                              onFocus={selectAll}
                              onChange={e => updateCartLoose(i, e.target.value)}
                            />
                          )}
                          <div className="space-y-1">
                            <Input
                              type="text"
                              inputMode="decimal"
                              aria-label={item.unit ? `Price per ${item.unit}` : "Price"}
                              title={item.unit ? `Price per ${item.unit}` : undefined}
                              className="w-24 h-8 text-xs"
                              value={item.priceText ?? String(item.unitPrice)}
                              onFocus={selectAll}
                              onChange={e => updateCartPrice(i, e.target.value)}
                              onBlur={() => finishCartPrice(i)}
                            />
                          </div>
                          <p className="text-sm font-semibold w-20 text-right tabular-nums">
                            {formatCurrency(lineAmount(item))}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-7 w-7 ${expandedCalcIndex === i ? 'text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/50' : 'text-muted-foreground'}`}
                            onClick={() => {
                              if (expandedCalcIndex === i) {
                                setExpandedCalcIndex(null);
                              } else {
                                setExpandedCalcIndex(i);
                                const comp = item.compData;
                                if (comp && !cartCalcValues[i]) {
                                  setCartCalcValues(prev => ({
                                    ...prev,
                                    [i]: {
                                      dimensionX: comp.dimensionX || 0,
                                      dimensionY: comp.dimensionY || 0,
                                      gsm: comp.gsm || 0,
                                      divisor: comp.divisor || 15500,
                                      weightKg: comp.weightKg || 0,
                                      rimInSheet: comp.rimInSheet || 100,
                                      ratePerKg: comp.ratePerKg || 0,
                                      purchasePrice: item.unitPrice,
                                      salePrice: item.unitPrice,
                                    }
                                  }));
                                }
                              }
                            }}
                            title="Price Calculator"
                            aria-label={`Price calculator for ${item.componentName}`}
                            aria-expanded={expandedCalcIndex === i}
                          >
                            <Calculator className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Remove ${item.componentName}`} title="Remove" onClick={() => removeFromCart(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {baseOf(item) > item.availableStock && (
                        <p className="px-3 pt-1 text-xs text-destructive">Only {item.availableStock} {stockUnit(item.compData)} in stock</p>
                      )}
                      {expandedCalcIndex === i && (
                        <div className="mt-1 mb-2">
                          <PriceCalculator
                            values={cartCalcValues[i] || defaultCalcValues}
                            onChange={(newVals) => {
                              setCartCalcValues(prev => ({ ...prev, [i]: newVals }));
                              if (newVals.salePrice > 0) {
                                updateCartPrice(i, String(newVals.salePrice));
                              } else if (newVals.purchasePrice > 0) {
                                updateCartPrice(i, String(newVals.purchasePrice));
                              }
                            }}
                            compact
                            showSalePrice={true}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right Column: Payment & Summary ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Payment Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4" /> Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isInvoiceEdit ? (
                <p className="text-sm text-muted-foreground">Payments already received stay with this bill. Receive more, or deal with any credit, from the bill page.</p>
              ) : (<>
              <div className="space-y-1">
                <Label>Paid now (Rs)</Label>
                <div className="flex gap-2">
                  <Input type="text" inputMode="decimal" value={paidNow === "" ? String(total) : paidNow} onFocus={selectAll} onChange={e => setPaidNow(cleanDecimal(e.target.value))} className="h-9" />
                  <Button type="button" variant="outline" size="sm" onClick={() => setPaidNow("")}>Full</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPaidNow("0")}>Nothing</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {customerType === "walkin"
                    ? "A walk-in customer normally pays in full."
                    : paidAmount >= total ? "Paid in full." : `${formatCurrency(total - paidAmount)} stays owed on this bill.`}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Method</Label>
                <Select value={paymentMethod} onChange={(val: string) => setPaymentMethod(val)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => {
                      const Icon = PAYMENT_ICONS[m.value] || Banknote;
                      return (
                        <SelectItem key={m.value} value={m.value}>
                          <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" /> {m.label}</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              </>)}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" /> Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>

                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-base">Total</span>
                    <span className="font-bold text-xl tracking-tight">{formatCurrency(total)}</span>
                  </div>
                  {totalProfit > 0 && (
                    <p className="text-xs text-emerald-600 text-right mt-1">Est. Profit: {formatCurrency(totalProfit)}</p>
                  )}
                </div>
              </div>

              {editing && (
                <div className="space-y-1 pt-2">
                  <Label>Reason for change *</Label>
                  <Input placeholder="e.g. customer took 3 instead of 1" value={reason} onChange={e => setReason(e.target.value)} />
                  <p className="text-xs text-muted-foreground">The bill gets a new revision with the same number; the earlier version and this reason stay in its history.</p>
                </div>
              )}

              <div className="space-y-1 pt-2">
                <Label>Notes (Optional)</Label>
                <Textarea 
                  placeholder="Add any remarks for this sale..." 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)}
                  className="resize-none h-20"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
