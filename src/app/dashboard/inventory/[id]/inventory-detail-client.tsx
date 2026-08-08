"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Edit, Trash2, Package, BarChart3, DollarSign, AlertTriangle,
  TrendingUp, TrendingDown, Clock, Hash, MapPin, User, ShoppingCart,
  Wrench, Plus, Minus, RefreshCw, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatCurrency, formatDate, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

interface ComponentDetail {
  id: string; sku: string; name: string; description: string | null;
  quantity: number; minQuantity: number; unitCost: number; unitPrice: number;
  location: string | null; isActive: boolean; totalPurchased: number;
  totalUsed: number; totalSold: number; totalDamaged: number;
  datasheetUrl: string | null; imageUrl: string | null;
  lastPurchasedAt: string | null; lastSoldAt: string | null;
  createdAt: string; updatedAt: string;
  category: { id: string; name: string; color: string };
  supplier: { id: string; name: string } | null;
  inventoryHistory: {
    id: string; type: string; quantity: number; balanceAfter: number;
    reference: string | null; notes: string | null; createdAt: string;
  }[];
  projectComponents: {
    id: string; quantity: number; unitCost: number; totalCost: number;
    project: { id: string; name: string; projectId: string };
  }[];
}

interface CategoryItem { id: string; name: string; color: string; }
interface SupplierOption { id: string; name: string; }

interface Props {
  component: ComponentDetail;
  categories: CategoryItem[];
  suppliers: SupplierOption[];
}

const historyTypeLabels: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  ADD: { label: "Stock Added", icon: Plus, color: "text-emerald-500" },
  REMOVE: { label: "Stock Removed", icon: Minus, color: "text-red-500" },
  PURCHASE: { label: "Purchased", icon: ShoppingCart, color: "text-blue-500" },
  PROJECT_USE: { label: "Project Use", icon: Wrench, color: "text-violet-500" },
  SALE: { label: "Sold", icon: DollarSign, color: "text-amber-500" },
  DAMAGED: { label: "Damaged", icon: Trash2, color: "text-red-500" },
  ADJUSTMENT: { label: "Adjustment", icon: RefreshCw, color: "text-gray-500" },
  RETURN: { label: "Return", icon: TrendingUp, color: "text-emerald-500" },
};

export default function InventoryDetailClient({ component: initial, categories, suppliers }: Props) {
  const router = useRouter();
  const [component, setComponent] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: component.name, description: component.description || "",
    categoryId: component.category.id, quantity: String(component.quantity),
    minQuantity: String(component.minQuantity), unitCost: String(component.unitCost),
    unitPrice: String(component.unitPrice), location: component.location || "",
    supplierId: component.supplier?.id || "none", sku: component.sku,
  });

  const [adjust, setAdjust] = useState({ type: "ADD", quantity: "1", notes: "" });

  const isLowStock = component.quantity <= component.minQuantity;
  const isOutOfStock = component.quantity <= 0;
  const profitMargin = component.unitPrice > 0
    ? ((component.unitPrice - component.unitCost) / component.unitPrice * 100).toFixed(1)
    : "0";

  const handleUpdate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/${component.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, description: form.description || undefined,
          categoryId: form.categoryId, quantity: parseInt(form.quantity) || 0,
          minQuantity: parseInt(form.minQuantity) || 5,
          unitCost: parseFloat(form.unitCost) || 0,
          unitPrice: parseFloat(form.unitPrice) || 0,
          location: form.location || undefined,
          supplierId: form.supplierId !== "none" ? form.supplierId : null,
          sku: form.sku,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setComponent(data.component);
      setEditing(false);
      toast.success("Product updated");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/${component.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Product deleted");
      router.push("/dashboard/inventory");
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleAdjust = async () => {
    setLoading(true);
    const qty = parseInt(adjust.quantity) || 0;
    if (qty <= 0) { toast.error("Enter valid quantity"); setLoading(false); return; }
    try {
      const newQty = adjust.type === "ADD" ? component.quantity + qty : Math.max(0, component.quantity - qty);
      const res = await fetch(`/api/inventory/${component.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: newQty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Adjustment failed");
      setComponent(data.component);
      setAdjusting(false);
      setAdjust({ type: "ADD", quantity: "1", notes: "" });
      toast.success("Stock adjusted");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/inventory")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{component.name}</h1>
              {isOutOfStock ? (
                <Badge variant="destructive">Out of Stock</Badge>
              ) : isLowStock ? (
                <Badge variant="warning">Low Stock</Badge>
              ) : (
                <Badge variant="success">In Stock</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">{component.sku}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAdjusting(true)}>
            <RefreshCw className="h-4 w-4 mr-1" /> Adjust Stock
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Edit className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Hash className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current Stock</p>
              <p className="text-xl font-bold">{component.quantity}</p>
              {isLowStock && <p className="text-xs text-amber-500">Min: {component.minQuantity}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <DollarSign className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Selling Price</p>
              <p className="text-xl font-bold">{formatCurrency(component.unitPrice)}</p>
              <p className="text-xs text-muted-foreground">Cost: {formatCurrency(component.unitCost)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
              <TrendingUp className="h-5 w-5 text-violet-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Profit Margin</p>
              <p className="text-xl font-bold">{profitMargin}%</p>
              <p className="text-xs text-muted-foreground">Per unit</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <BarChart3 className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-xl font-bold">{formatCurrency(component.quantity * component.unitCost)}</p>
              <p className="text-xs text-muted-foreground">At cost</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Component Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category</span>
              <Badge variant="outline" style={{ borderColor: component.category.color, color: component.category.color }}>
                {component.category.name}
              </Badge>
            </div>
            {component.description && (
              <div>
                <span className="text-muted-foreground block mb-1">Description</span>
                <p>{component.description}</p>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location</span>
              <span>{component.location || "Not set"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Supplier</span>
              <span>{component.supplier?.name || "None"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(component.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Updated</span>
              <span>{timeAgo(component.updatedAt)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Usage Stats */}
        <Card>
          <CardHeader><CardTitle className="text-base">Usage Statistics</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Purchased</span>
              <span className="font-medium">{component.totalPurchased}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Used in Projects</span>
              <span className="font-medium">{component.totalUsed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sold to Customers</span>
              <span className="font-medium">{component.totalSold}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Damaged / Lost</span>
              <span className="font-medium text-red-500">{component.totalDamaged}</span>
            </div>
            {component.lastPurchasedAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Purchased</span>
                <span>{formatDate(component.lastPurchasedAt)}</span>
              </div>
            )}
            {component.lastSoldAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Sold</span>
                <span>{formatDate(component.lastSoldAt)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Project Usage */}
      {component.projectComponents.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Used in Projects</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {component.projectComponents.map(pc => (
                <div key={pc.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{pc.project.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{pc.project.projectId}</p>
                  </div>
                  <div className="text-sm text-right">
                    <p>Qty: {pc.quantity}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(pc.totalCost)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Inventory History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {component.inventoryHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No history recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {component.inventoryHistory.map(h => {
                const hType = historyTypeLabels[h.type] || historyTypeLabels.ADJUSTMENT;
                const HIcon = hType.icon;
                return (
                  <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-muted`}>
                        <HIcon className={`h-4 w-4 ${hType.color}`} />
                      </div>
                      <div>
                        <p className="font-medium">{hType.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {h.reference && <span>{h.reference} · </span>}
                          {h.notes && <span>{h.notes}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono font-medium ${h.quantity > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {h.quantity > 0 ? "+" : ""}{h.quantity}
                      </p>
                      <p className="text-xs text-muted-foreground">Balance: {h.balanceAfter}</p>
                      <p className="text-xs text-muted-foreground">{timeAgo(h.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editing} onClose={() => setEditing(false)}>
        <DialogHeader><DialogTitle>Edit Component</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-1"><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} /></div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Category</Label>
              <Select value={form.categoryId} onChange={v => setForm({...form, categoryId: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Supplier</Label>
              <Select value={form.supplierId} onChange={v => setForm({...form, supplierId: v})}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} /></div>
            <div className="space-y-1"><Label>Min Quantity Alert</Label><Input type="number" value={form.minQuantity} onChange={e => setForm({...form, minQuantity: e.target.value})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Unit Cost (Rs.)</Label><Input type="number" step="0.01" value={form.unitCost} onChange={e => setForm({...form, unitCost: e.target.value})} /></div>
            <div className="space-y-1"><Label>Unit Price (Rs.)</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm({...form, unitPrice: e.target.value})} /></div>
          </div>
          <div className="space-y-1"><Label>Location</Label><Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="Shelf / Bin" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
          <Button onClick={handleUpdate} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </Dialog>

      {/* Adjust Stock Dialog */}
      <Dialog open={adjusting} onClose={() => setAdjusting(false)}>
        <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-4">
          <p className="text-sm text-muted-foreground">Current stock: <span className="font-bold">{component.quantity}</span></p>
          <div className="space-y-1"><Label>Type</Label>
            <Select value={adjust.type} onChange={v => setAdjust({...adjust, type: v})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADD">Add Stock</SelectItem>
                <SelectItem value="REMOVE">Remove Stock</SelectItem>
                <SelectItem value="DAMAGED">Mark as Damaged</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Quantity</Label><Input type="number" min="1" value={adjust.quantity} onChange={e => setAdjust({...adjust, quantity: e.target.value})} /></div>
          <div className="space-y-1"><Label>Notes</Label><Input value={adjust.notes} onChange={e => setAdjust({...adjust, notes: e.target.value})} placeholder="Reason for adjustment" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAdjusting(false)}>Cancel</Button>
          <Button onClick={handleAdjust} disabled={loading}>{loading ? "Adjusting..." : "Apply Adjustment"}</Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleting} onClose={() => setDeleting(false)} onConfirm={handleDelete}
        title="Delete Product"
        description={`Are you sure you want to delete "${component.name}"? This will remove all inventory history.`}
        variant="destructive"
        loading={loading}
      />
    </div>
  );
}