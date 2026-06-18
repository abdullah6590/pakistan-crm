"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Package, PackageOpen, AlertTriangle, TrendingDown,
  BarChart3, Edit, Trash2, Filter, ChevronDown, Box,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { DEFAULT_COMPONENT_CATEGORIES } from "@/lib/constants";
import { toast } from "sonner";

interface ComponentItem {
  id: string; sku: string; name: string; description: string | null;
  quantity: number; minQuantity: number; unitCost: number; unitPrice: number;
  location: string | null; isActive: boolean; totalPurchased: number;
  totalUsed: number; totalSold: number; createdAt: string; updatedAt: string;
  category: { id: string; name: string; color: string };
  supplier: { id: string; name: string } | null;
}

interface CategoryItem { id: string; name: string; color: string; }
interface SupplierOption { id: string; name: string; }

interface InventoryClientProps {
  components: ComponentItem[];
  categories: CategoryItem[];
  suppliers: SupplierOption[];
  stats: { totalQuantity: number; totalValue: number; totalItems: number; lowStockCount: number };
}

export default function InventoryClient({ components: initialComponents, categories, suppliers, stats }: InventoryClientProps) {
  const router = useRouter();
  const [components, setComponents] = useState(initialComponents);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ComponentItem | null>(null);
  const [deleting, setDeleting] = useState<ComponentItem | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: "", description: "", sku: "", categoryId: "",
    quantity: "0", minQuantity: "5", unitCost: "0", unitPrice: "0",
    location: "", supplierId: "none",
  });

  const resetForm = () => setForm({
    name: "", description: "", sku: "", categoryId: "",
    quantity: "0", minQuantity: "5", unitCost: "0", unitPrice: "0",
    location: "", supplierId: "none",
  });

  const openEdit = (c: ComponentItem) => {
    setEditing(c);
    setForm({
      name: c.name, description: c.description || "", sku: c.sku,
      categoryId: c.category.id, quantity: String(c.quantity),
      minQuantity: String(c.minQuantity), unitCost: String(c.unitCost),
      unitPrice: String(c.unitPrice), location: c.location || "",
      supplierId: c.supplier?.id || "none",
    });
  };

  const filtered = useMemo(() => {
    let list = components;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.sku.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") list = list.filter(c => c.category.id === categoryFilter);
    if (lowStockOnly) list = list.filter(c => c.quantity <= c.minQuantity);
    return list;
  }, [components, search, categoryFilter, lowStockOnly]);

  const handleCreate = async () => {
    if (!form.name || !form.categoryId) { toast.error("Name and category are required"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          sku: form.sku || undefined,
          categoryId: form.categoryId,
          quantity: parseInt(form.quantity) || 0,
          minQuantity: parseInt(form.minQuantity) || 5,
          unitCost: parseFloat(form.unitCost) || 0,
          unitPrice: parseFloat(form.unitPrice) || 0,
          location: form.location || undefined,
          supplierId: form.supplierId !== "none" ? form.supplierId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setComponents(prev => [data.component, ...prev]);
      setShowAdd(false);
      resetForm();
      toast.success("Component added");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    if (!editing || !form.name || !form.categoryId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          sku: form.sku,
          categoryId: form.categoryId,
          quantity: parseInt(form.quantity) || 0,
          minQuantity: parseInt(form.minQuantity) || 5,
          unitCost: parseFloat(form.unitCost) || 0,
          unitPrice: parseFloat(form.unitPrice) || 0,
          location: form.location || undefined,
          supplierId: form.supplierId !== "none" ? form.supplierId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setComponents(prev => prev.map(c => c.id === editing.id ? data.component : c));
      setEditing(null);
      toast.success("Component updated");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setComponents(prev => prev.filter(c => c.id !== deleting.id));
      setDeleting(null);
      toast.success("Component deleted");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const getStockBadge = (c: ComponentItem) => {
    if (c.quantity <= 0) return <Badge variant="destructive" size="sm">Out of Stock</Badge>;
    if (c.quantity <= c.minQuantity) return <Badge variant="warning" size="sm">Low Stock</Badge>;
    return <Badge variant="success" size="sm">In Stock</Badge>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Manage electronic components, stock levels, and suppliers"
        icon={Box}
        actions={
          <Button onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Component
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Package className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Items</p>
              <p className="text-xl font-bold">{stats.totalItems}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <BarChart3 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Quantity</p>
              <p className="text-xl font-bold">{stats.totalQuantity.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
              <Package className="h-5 w-5 text-violet-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inventory Value</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalValue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Low Stock Items</p>
              <p className="text-xl font-bold">{stats.lowStockCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name or SKU..." className="flex-1" />
            <Select value={categoryFilter} onChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={lowStockOnly ? "default" : "outline"}
              size="icon"
              onClick={() => setLowStockOnly(!lowStockOnly)}
              title="Low stock only"
            >
              <TrendingDown className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="No components found"
              description={search || categoryFilter !== "all" ? "Try adjusting your filters" : "Add your first component to get started"}
              action={search || categoryFilter !== "all" ? undefined : { label: "Add Component", onClick: () => setShowAdd(true) }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{c.name}</p>
                          {c.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{c.description}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm" style={{ borderColor: c.category.color, color: c.category.color }}>
                          {c.category.name}
                        </Badge>
                      </TableCell>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.sku}</code></TableCell>
                      <TableCell className="text-right font-mono text-sm">{c.quantity}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(c.unitCost)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(c.unitPrice)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(c.quantity * c.unitCost)}</TableCell>
                      <TableCell className="text-sm">{c.supplier?.name || "—"}</TableCell>
                      <TableCell>{getStockBadge(c)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleting(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={showAdd || !!editing} onClose={() => { setShowAdd(false); setEditing(null); }}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Component" : "Add Component"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Arduino Uno R3" />
            </div>
            <div className="space-y-1">
              <Label>SKU</Label>
              <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} placeholder="Auto-generated if empty" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} placeholder="Brief description..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Category *</Label>
              <Select value={form.categoryId} onChange={v => setForm({...form, categoryId: v})}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={form.supplierId} onChange={v => setForm({...form, supplierId: v})}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Quantity</Label>
              <Input type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} />
            </div>
            <div className="space-y-1">
              <Label>Min Quantity Alert</Label>
              <Input type="number" value={form.minQuantity} onChange={e => setForm({...form, minQuantity: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Unit Cost (Rs.)</Label>
              <Input type="number" step="0.01" value={form.unitCost} onChange={e => setForm({...form, unitCost: e.target.value})} />
            </div>
            <div className="space-y-1">
              <Label>Unit Price (Rs.)</Label>
              <Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm({...form, unitPrice: e.target.value})} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Location</Label>
            <Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="e.g. Shelf A-3" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
          <Button onClick={editing ? handleUpdate : handleCreate} disabled={loading}>
            {loading ? "Saving..." : editing ? "Save Changes" : "Add Component"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)} onConfirm={handleDelete}
        title="Delete Component"
        description={`Are you sure you want to delete "${deleting?.name}"? This action cannot be undone.`}
        variant="destructive"
        loading={loading}
      />
    </div>
  );
}