"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Save, Truck, Package,
  Search, Building2, FileText, DollarSign, Calculator,
  Banknote, Smartphone, BadgeCheck, Clock,
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

// ─── Types ──────────────────────────────────────────────────────────
interface ComponentOption {
  id: string; name: string; sku: string; quantity: number;
  unitCost: number; unitPrice: number; minQuantity: number;
  description?: string; location?: string;
  category?: { name: string } | null;
  supplier?: { name: string } | null;
}

interface SupplierOption { id: string; name: string; phone: string; }

interface CartItem {
  componentId: string;
  componentName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  currentStock: number;
}

interface Props {
  components: ComponentOption[];
  suppliers: SupplierOption[];
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  CASH: Banknote, BANK_TRANSFER: Banknote,
  JAZZCASH: Smartphone, EASYPAISA: Smartphone,
  NAYAPAY: Smartphone, SADAPAY: Smartphone,
};

export default function NewPurchaseClient({ components, suppliers }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Form state
  const [supplierId, setSupplierId] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("PENDING");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [paidAmount, setPaidAmount] = useState("0");
  const [tax, setTax] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [notes, setNotes] = useState("");

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);

  // Component search
  const [searchQuery, setSearchQuery] = useState("");
  const filteredComponents = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return components
      .filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.sku.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [searchQuery, components]);

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

  const selectedSupplier = suppliers.find(s => s.id === supplierId);

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error("Add at least one component to the purchase"); return; }
    if (!supplierId) { toast.error("Select a supplier"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          invoiceRef: invoiceRef.trim() || undefined,
          paymentStatus,
          paymentMethod,
          paidAmount: parseFloat(paidAmount) || 0,
          tax: taxAmount,
          shipping: shippingAmount,
          notes: notes.trim() || undefined,
          supplierName: selectedSupplier?.name,
          items: cart.map(item => ({
            componentId: item.componentId,
            quantity: item.quantity,
            unitCost: item.unitCost,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create purchase");
      toast.success("Purchase order created!");
      router.push("/dashboard/purchases");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
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
        <Button onClick={handleSubmit} disabled={loading || cart.length === 0} className="gap-2">
          {loading ? <Calculator className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {loading ? "Creating..." : "Create Purchase"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Left Column: Supplier & Cart ── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Supplier Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Supplier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Select Supplier *</Label>
                <Select value={supplierId} onChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Search supplier..." /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Invoice Reference (optional)</Label>
                <Input placeholder="Supplier's invoice number" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* Cart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base"><Package className="h-4 w-4" /> Components ({cart.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Component Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search components by name or SKU..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
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
                            {comp.sku} · Stock: {comp.quantity} · Cost: {formatCurrency(comp.unitCost)}
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
                  <p className="text-sm">No components added yet</p>
                  <p className="text-xs">Search above to add components</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((item, i) => (
                    <div key={`${item.componentId}-${i}`} className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.componentName}</p>
                        <p className="text-xs text-muted-foreground">{item.sku} · Current Stock: {item.currentStock}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Qty</Label>
                          <Input
                            type="number"
                            className="w-16 h-8 text-center text-xs"
                            min={1}
                            value={item.quantity}
                            onChange={e => updateCartQty(i, e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Unit Cost</Label>
                          <Input
                            type="number"
                            className="w-24 h-8 text-xs"
                            value={item.unitCost}
                            onChange={e => updateCartCost(i, e.target.value)}
                          />
                        </div>
                        <p className="text-sm font-semibold w-24 text-right tabular-nums pt-4">
                          {formatCurrency(item.unitCost * item.quantity)}
                        </p>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive mt-3" onClick={() => removeFromCart(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
              <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4" /> Payment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={paymentStatus} onChange={setPaymentStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAID">Paid</SelectItem>
                    <SelectItem value="PARTIAL">Partial</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onChange={setPaymentMethod}>
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
              <div className="space-y-1">
                <Label>Amount Paid (PKR)</Label>
                <Input type="number" min="0" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tax (PKR)</Label>
                  <Input type="number" min="0" value={tax} onChange={e => setTax(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Shipping (PKR)</Label>
                  <Input type="number" min="0" value={shipping} onChange={e => setShipping(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea placeholder="Any notes..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Items</span>
                <span className="font-medium">{cart.length} ({totalItems} units)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(taxAmount)}</span>
                </div>
              )}
              {shippingAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>{formatCurrency(shippingAmount)}</span>
                </div>
              )}
              <div className="border-t pt-3 flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-lg">{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-medium text-emerald-600">{formatCurrency(parseFloat(paidAmount) || 0)}</span>
              </div>
              {total - (parseFloat(paidAmount) || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balance Due</span>
                  <span className="font-medium text-amber-600">{formatCurrency(total - (parseFloat(paidAmount) || 0))}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}