"use client";

import { useState, useMemo } from "react";
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

// ─── Types ──────────────────────────────────────────────────────────
interface ComponentOption {
  id: string; name: string; sku: string; quantity: number;
  unitCost: number; unitPrice: number; minQuantity: number;
  description?: string; location?: string;
  category?: { name: string } | null;
  supplier?: { name: string } | null;
}

interface CustomerOption { id: string; name: string; phone: string; }

interface CartItem {
  componentId: string;
  componentName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  availableStock: number;
}

interface Props {
  components: ComponentOption[];
  customers: CustomerOption[];
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  CASH: Banknote, BANK_TRANSFER: Banknote,
  JAZZCASH: Smartphone, EASYPAISA: Smartphone,
  NAYAPAY: Smartphone, SADAPAY: Smartphone,
};

export default function NewSaleClient({ components, customers }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Form state
  const [customerType, setCustomerType] = useState<"existing" | "walkin">("existing");
  const [customerId, setCustomerId] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentStatus, setPaymentStatus] = useState("PAID");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
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
      if (existing.quantity >= comp.quantity) {
        toast.error(`Only ${comp.quantity} units in stock`);
        return;
      }
      setCart(cart.map(c =>
        c.componentId === comp.id ? { ...c, quantity: c.quantity + 1 } : c
      ));
    } else {
      if (comp.quantity <= 0) {
        toast.error(`${comp.name} is out of stock`);
        return;
      }
      setCart([...cart, {
        componentId: comp.id,
        componentName: comp.name,
        sku: comp.sku,
        quantity: 1,
        unitCost: comp.unitCost,
        unitPrice: comp.unitPrice,
        availableStock: comp.quantity,
      }]);
    }
    setSearchQuery("");
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const updateCartQty = (index: number, qty: string) => {
    const num = parseInt(qty) || 1;
    const item = cart[index];
    if (num > item.availableStock) {
      toast.error(`Only ${item.availableStock} units in stock`);
      return;
    }
    const updated = [...cart];
    updated[index] = { ...updated[index], quantity: Math.max(1, num) };
    setCart(updated);
  };

  const updateCartPrice = (index: number, price: string) => {
    const num = parseFloat(price) || 0;
    const updated = [...cart];
    updated[index] = { ...updated[index], unitPrice: Math.max(0, num) };
    setCart(updated);
  };

  // ─── Totals ─────────────────────────────────────────────────────────
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountAmount = (parseFloat(discount) || 0);
  const taxAmount = (parseFloat(tax) || 0);
  const total = subtotal - discountAmount + taxAmount;
  const totalProfit = cart.reduce((sum, item) => sum + (item.unitPrice - item.unitCost) * item.quantity, 0);

  const selectedCustomer = customers.find(c => c.id === customerId);

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error("Add at least one component to the sale"); return; }
    if (customerType === "existing" && !customerId) { toast.error("Select a customer"); return; }
    if (customerType === "walkin" && !walkInName.trim()) { toast.error("Enter customer name"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerType === "existing" ? customerId : null,
          walkInName: customerType === "walkin" ? walkInName.trim() : null,
          walkInPhone: customerType === "walkin" ? walkInPhone.trim() || null : null,
          paymentMethod,
          paymentStatus,
          discount: discountAmount,
          tax: taxAmount,
          notes: notes.trim() || undefined,
          items: cart.map(item => ({
            componentId: item.componentId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            unitPrice: item.unitPrice,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create sale");
      toast.success("Sale recorded successfully!");
      router.push("/dashboard/sales");
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
            <h1 className="text-2xl font-bold tracking-tight">New Sale</h1>
            <p className="text-sm text-muted-foreground">Record a component sale — walk-in or registered customer</p>
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={loading || cart.length === 0} className="gap-2">
          {loading ? <Calculator className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {loading ? "Saving..." : "Complete Sale"}
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
                >
                  Registered
                </Button>
                <Button
                  variant={customerType === "walkin" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCustomerType("walkin")}
                >
                  Walk-in
                </Button>
              </div>

              {customerType === "existing" ? (
                <div className="space-y-1">
                  <Label>Select Customer</Label>
                  <Select value={customerId} onChange={setCustomerId}>
                    <SelectTrigger><SelectValue placeholder="Search customer..." /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} {c.phone ? `(${c.phone})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCustomer && (
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> {selectedCustomer.name}</span>
                      {selectedCustomer.phone && (
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selectedCustomer.phone}</span>
                      )}
                    </div>
                  )}
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
                            {comp.sku} · Stock: {comp.quantity} · {formatCurrency(comp.unitPrice)}
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
                  <p className="text-xs">Search above to add components</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((item, i) => (
                    <div key={`${item.componentId}-${i}`} className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.componentName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.sku} · Stock: {item.availableStock} · Cost: {formatCurrency(item.unitCost)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="space-y-1">
                          <Input
                            type="number"
                            className="w-16 h-8 text-center text-xs"
                            min={1}
                            max={item.availableStock}
                            value={item.quantity}
                            onChange={e => updateCartQty(i, e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Input
                            type="number"
                            className="w-24 h-8 text-xs"
                            value={item.unitPrice}
                            onChange={e => updateCartPrice(i, e.target.value)}
                          />
                        </div>
                        <p className="text-sm font-semibold w-20 text-right tabular-nums">
                          {formatCurrency(item.unitPrice * item.quantity)}
                        </p>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFromCart(i)}>
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
              <CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4" /> Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Method</Label>
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
                <Label>Discount (PKR)</Label>
                <Input type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Tax / Additional Charges (PKR)</Label>
                <Input type="number" min="0" value={tax} onChange={e => setTax(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea placeholder="Any notes for this sale..." rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" /> Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Items</span>
                <span className="font-medium">{cart.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span className="flex items-center gap-1"><Minus className="h-3 w-3" /> Discount</span>
                  <span>-{formatCurrency(discountAmount)}</span>
                </div>
              )}
              {taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1"><Percent className="h-3 w-3" /> Tax/Charges</span>
                  <span>{formatCurrency(taxAmount)}</span>
                </div>
              )}
              <div className="border-t pt-3 flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-lg">{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated Profit</span>
                <span className={`font-medium ${totalProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                  {formatCurrency(totalProfit)}
                </span>
              </div>
              {cart.some(item => item.quantity > item.availableStock) && (
                <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Some items exceed available stock</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}