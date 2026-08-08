"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Save, Truck, Package, ShoppingCart,
  Search, Building2, FileText, DollarSign, Calculator,
  Banknote, Smartphone, BadgeCheck, Clock, Camera, CheckCircle2, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import InvoiceScanner from "@/components/ai/invoice-scanner";
import PriceCalculator, { type PriceCalcValues, defaultCalcValues } from "@/components/shared/price-calculator";

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
}

interface SupplierOption { id: string; name: string; phone: string; }

interface CartItem {
  componentId: string;
  componentName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  currentStock: number;
  compData: ComponentOption;
}

interface Props {
  initialComponents: ComponentOption[];
  initialSuppliers: SupplierOption[];
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  CASH: Banknote, BANK_TRANSFER: Banknote,
  JAZZCASH: Smartphone, EASYPAISA: Smartphone,
  NAYAPAY: Smartphone, SADAPAY: Smartphone,
};

export default function NewPurchaseClient({ initialComponents, initialSuppliers }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Form state
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierOption | null>(null);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("PENDING");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [paidAmount, setPaidAmount] = useState("0");
  const [tax, setTax] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [notes, setNotes] = useState("");

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);

  // Scanner
  const [showScanner, setShowScanner] = useState(false);

  // ─── Component Search State ───
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredComponents, setFilteredComponents] = useState<ComponentOption[]>(initialComponents);
  const [isSearchingComponents, setIsSearchingComponents] = useState(false);
  const [expandedCalcIndex, setExpandedCalcIndex] = useState<number | null>(null);
  const [cartCalcValues, setCartCalcValues] = useState<Record<number, PriceCalcValues>>({});

  // ─── Supplier Search State ───
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("");
  const [filteredSuppliers, setFilteredSuppliers] = useState<SupplierOption[]>(initialSuppliers);
  const [isSearchingSuppliers, setIsSearchingSuppliers] = useState(false);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);

  // ─── Async Component Search ───
  useEffect(() => {
    const controller = new AbortController();
    
    if (searchQuery.trim().length === 0) {
      setFilteredComponents(initialComponents);
      setIsSearchingComponents(false);
      return;
    }

    if (searchQuery.trim().length < 2) {
      setFilteredComponents([]);
      return;
    }

    const fetchComponents = async () => {
      setIsSearchingComponents(true);
      try {
        const res = await fetch(`/api/search/components?q=${encodeURIComponent(searchQuery)}&limit=10`, {
          signal: controller.signal
        });
        const data = await res.json();
        if (data.data) {
          setFilteredComponents(data.data);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error(err);
      } finally {
        setIsSearchingComponents(false);
      }
    };

    const timer = setTimeout(fetchComponents, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, initialComponents]);

  // ─── Async Supplier Search ───
  useEffect(() => {
    const controller = new AbortController();
    
    if (supplierSearchQuery.trim().length === 0) {
      setFilteredSuppliers(initialSuppliers);
      setIsSearchingSuppliers(false);
      return;
    }

    if (supplierSearchQuery.trim().length < 2) {
      setFilteredSuppliers([]);
      return;
    }

    const fetchSuppliers = async () => {
      setIsSearchingSuppliers(true);
      try {
        const res = await fetch(`/api/search/suppliers?q=${encodeURIComponent(supplierSearchQuery)}&limit=10`, {
          signal: controller.signal
        });
        const data = await res.json();
        if (data.data) {
          setFilteredSuppliers(data.data);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error(err);
      } finally {
        setIsSearchingSuppliers(false);
      }
    };

    const timer = setTimeout(fetchSuppliers, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [supplierSearchQuery, initialSuppliers]);

  const addToCart = (comp: ComponentOption) => {
    const existing = cart.find(c => c.componentId === comp.id);
    if (existing) {
      setCart(cart.map(c =>
        c.componentId === comp.id ? { ...c, quantity: c.quantity + 1 } : c
      ));
    } else {
      setCart([...cart, {
        componentId: comp.id,
        componentName: comp.name,
        sku: comp.sku,
        quantity: 1,
        unitCost: comp.unitCost,
        currentStock: comp.quantity,
        compData: comp,
      }]);
    }
    setSearchQuery("");
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const updateCartQty = (index: number, qty: string) => {
    const num = parseInt(qty) || 1;
    const updated = [...cart];
    updated[index] = { ...updated[index], quantity: Math.max(1, num) };
    setCart(updated);
  };

  const updateCartCost = (index: number, cost: string) => {
    const num = parseFloat(cost) || 0;
    const updated = [...cart];
    updated[index] = { ...updated[index], unitCost: Math.max(0, num) };
    setCart(updated);
  };

  // ─── Totals ─────────────────────────────────────────────────────────
  const subtotal = cart.reduce((sum, item) => sum + item.unitCost * item.quantity, 0);
  const taxAmount = (parseFloat(tax) || 0);
  const shippingAmount = (parseFloat(shipping) || 0);
  const total = subtotal + taxAmount + shippingAmount;
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error("Add at least one component to the purchase"); return; }
    if (!selectedSupplier) { toast.error("Select a supplier"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: selectedSupplier.id,
          invoiceRef: invoiceRef.trim() || undefined,
          paymentStatus,
          paymentMethod,
          paidAmount: parseFloat(paidAmount) || 0,
          tax: taxAmount,
          shipping: shippingAmount,
          notes: notes.trim() || undefined,
          supplierName: selectedSupplier.name,
          items: cart.map(item => ({
            componentId: item.componentId,
            quantity: item.quantity,
            unitCost: item.unitCost,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to create purchase");
        return;
      }
      
      toast.success("Purchase order created!");
      setCart([]);
      setSearchQuery("");
      setInvoiceRef("");
      setPaidAmount("");
      setTax("");
      setShipping("");
      setPaymentMethod("CASH");
      setPaymentStatus("PENDING");
      setNotes("");
      setSelectedSupplier(null);
      
      router.push("/dashboard/purchases");
      router.refresh();
    } catch (err: any) {
      console.error("Purchase submission error:", err);
      toast.error(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Purchase</h1>
            <p className="text-sm text-muted-foreground">Record a component purchase from a supplier</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowScanner(true)} className="gap-2 border-purple-300 text-purple-600 hover:bg-purple-50 hover:text-purple-700">
            <Camera className="h-4 w-4" /> Scan Invoice
          </Button>
          <Button onClick={handleSubmit} disabled={loading || cart.length === 0} className="gap-2">
            {loading ? <Calculator className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {loading ? "Creating..." : "Create Purchase"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Left Column: Cart & Details ── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Supplier & Invoice */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Purchase Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="relative">
                    <Label className="mb-2 block">Search Supplier *</Label>
                    {!selectedSupplier ? (
                      <>
                        <Input
                          placeholder="Search by name or phone..."
                          value={supplierSearchQuery}
                          onChange={e => {
                            setSupplierSearchQuery(e.target.value);
                            setShowSupplierDropdown(true);
                          }}
                          onFocus={() => setShowSupplierDropdown(true)}
                          onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 200)}
                        />
                        {isSearchingSuppliers && <div className="absolute right-3 top-9 text-xs text-muted-foreground">Searching...</div>}
                        
                        {showSupplierDropdown && filteredSuppliers.length > 0 && (
                          <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background shadow-lg max-h-60 overflow-y-auto">
                            {filteredSuppliers.map(s => (
                              <button
                                key={s.id}
                                type="button"
                                className="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-muted transition-colors border-b last:border-0"
                                onMouseDown={(e) => {
                                  e.preventDefault(); // prevent blur
                                  setSelectedSupplier(s);
                                  setShowSupplierDropdown(false);
                                  setSupplierSearchQuery("");
                                }}
                              >
                                <span className="text-sm font-medium">{s.name}</span>
                                {s.phone && <span className="text-xs text-muted-foreground">{s.phone}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
                        <div>
                          <p className="text-sm font-medium">{selectedSupplier.name}</p>
                          {selectedSupplier.phone && <p className="text-xs text-muted-foreground">{selectedSupplier.phone}</p>}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedSupplier(null)}>
                          Change
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Invoice Ref (Optional)</Label>
                  <Input placeholder="e.g. INV-2024-001" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cart Items */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="h-4 w-4" /> Received Items ({totalItems})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Component Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products to add..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {isSearchingComponents && <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Searching...</div>}
                
                {searchQuery.trim() !== "" && filteredComponents.length === 0 && !isSearchingComponents && (
                  <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background p-4 text-center text-sm text-muted-foreground shadow-lg">
                    No products found.
                  </div>
                )}

                {filteredComponents.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background shadow-lg max-h-60 overflow-y-auto">
                    {filteredComponents.map(comp => (
                      <button
                        key={comp.id}
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted transition-colors border-b last:border-0"
                        onClick={() => addToCart(comp)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{comp.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {comp.sku} · Current Stock: {comp.quantity}
                          </p>
                        </div>
                        <Plus className="h-4 w-4 ml-2 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg mt-4">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium text-foreground">No items received yet</p>
                  <p className="text-xs">Search above or scan an invoice to add items</p>
                </div>
              ) : (
                <div className="space-y-2 mt-4">
                  {cart.map((item, i) => (
                    <div key={`${item.componentId}-${i}`} className="space-y-0">
                      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.componentName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.sku} · Cur: {item.currentStock} → <span className="font-medium text-emerald-600">New: {item.currentStock + item.quantity}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="space-y-1">
                            <Input
                              type="number"
                              className="w-20 h-8 text-center text-xs"
                              min={1}
                              value={item.quantity}
                              onChange={e => updateCartQty(i, e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Input
                              type="number"
                              className="w-24 h-8 text-xs"
                              step="0.01"
                              value={item.unitCost}
                              onChange={e => updateCartCost(i, e.target.value)}
                            />
                          </div>
                          <p className="text-sm font-semibold w-20 text-right tabular-nums">
                            {formatCurrency(item.unitCost * item.quantity)}
                          </p>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className={`h-7 w-7 ${expandedCalcIndex === i ? 'text-indigo-600 bg-indigo-50' : 'text-muted-foreground'}`} 
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
                                      purchasePrice: item.unitCost,
                                      salePrice: comp.unitPrice,
                                    }
                                  }));
                                }
                              }
                            }}
                            title="Price Calculator"
                          >
                            <Calculator className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFromCart(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {expandedCalcIndex === i && (
                        <div className="mt-1 mb-2">
                          <PriceCalculator
                            values={cartCalcValues[i] || defaultCalcValues}
                            onChange={(newVals) => {
                              setCartCalcValues(prev => ({ ...prev, [i]: newVals }));
                              if (newVals.purchasePrice > 0) {
                                updateCartCost(i, String(newVals.purchasePrice));
                              }
                            }}
                            compact
                            showSalePrice={false}
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
          {/* Payment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4" /> Payment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={paymentStatus} onChange={(val: string) => setPaymentStatus(val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PAID">Paid</SelectItem>
                      <SelectItem value="PARTIAL">Partial</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                    </SelectContent>
                  </Select>
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
              </div>
              
              {paymentStatus !== "PENDING" && (
                <div className="space-y-1 pt-2 border-t">
                  <Label>Amount Paid (Rs)</Label>
                  <Input 
                    type="number" 
                    value={paidAmount} 
                    onChange={e => setPaidAmount(e.target.value)} 
                    placeholder="e.g. 5000"
                  />
                  {paymentStatus === "PARTIAL" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Remaining balance will be added to supplier ledger.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Tax (Rs)</Label>
                    <Input type="number" min="0" value={tax} onChange={e => setTax(e.target.value)} className="h-8" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Shipping (Rs)</Label>
                    <Input type="number" min="0" value={shipping} onChange={e => setShipping(e.target.value)} className="h-8" />
                  </div>
                </div>

                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-base">Total Cost</span>
                    <span className="font-bold text-xl tracking-tight">{formatCurrency(total)}</span>
                  </div>
                  
                  {paymentStatus === "PARTIAL" && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-dashed">
                      <span className="text-sm font-medium text-amber-600">Balance Due</span>
                      <span className="font-semibold text-amber-600">{formatCurrency(Math.max(0, total - (parseFloat(paidAmount) || 0)))}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1 pt-2">
                <Label>Notes (Optional)</Label>
                <Textarea 
                  placeholder="Add any remarks for this purchase..." 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)}
                  className="resize-none h-20"
                />
              </div>

              <div className="pt-4 mt-4 border-t">
                <Button 
                  className="w-full h-12 text-lg font-bold" 
                  onClick={handleSubmit} 
                  disabled={loading || cart.length === 0}
                >
                  {loading ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Processing...</span>
                  ) : (
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> Complete Purchase</span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {showScanner && (
        <InvoiceScanner 
          open={showScanner}
          onClose={() => setShowScanner(false)} 
          onConfirm={(items, meta) => {
            toast.success("Invoice scanned successfully");
            setShowScanner(false);
          }}
        />
      )}
    </div>
  );
}