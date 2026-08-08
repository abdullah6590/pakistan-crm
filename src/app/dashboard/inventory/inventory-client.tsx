"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Package, PackageOpen, AlertTriangle, TrendingDown,
  BarChart3, Edit, Trash2, Filter, ChevronDown, ChevronLeft, ChevronRight, Box, Printer, Sparkles, TrendingUp, Weight,
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
import { AdvancedFilter } from "@/components/shared/advanced-filter";
import PriceCalculator, { type PriceCalcValues, defaultCalcValues } from "@/components/shared/price-calculator";
import { formatCurrency, timeAgo, formatDate } from "@/lib/utils";
import { DEFAULT_COMPONENT_CATEGORIES, COMPANY_INFO } from "@/lib/constants";
import { toast } from "sonner";
import { suggestPrices, checkBelowCost } from "@/lib/ai-engine";

interface ComponentItem {
  id: string; sku: string; name: string; description: string | null;
  quantity: number; minQuantity: number; unitCost: number; unitPrice: number;
  packagingUnit: string; itemsPerPackage: number; supplierPrice: number; expenses: number;
  location: string | null; isActive: boolean; totalPurchased: number;
  totalUsed: number; totalSold: number; createdAt: string; updatedAt: string;
  size: string | null; grams: number | null; unit: string; customFields: string | null;
  dimensionX: number | null; dimensionY: number | null; gsm: number | null;
  divisor: number | null; weightKg: number | null; rimInSheet: number | null; ratePerKg: number | null;
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
  pagination: { page: number; totalPages: number; totalRecords: number };
}

export default function InventoryClient({ components, categories, suppliers, stats, pagination }: InventoryClientProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ComponentItem | null>(null);
  const [deleting, setDeleting] = useState<ComponentItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [localCategories, setLocalCategories] = useState(categories);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [calcValues, setCalcValues] = useState<PriceCalcValues>(defaultCalcValues);

  // Form state
  const [form, setForm] = useState({
    name: "", description: "", sku: "", categoryId: "",
    quantity: "0", minQuantity: "5", unitCost: "0", unitPrice: "0",
    packagingUnit: "Carton", itemsPerPackage: "1", supplierPrice: "0", expenses: "0",
    packages: "0", looseQuantity: "0",
    location: "", supplierId: "none", size: "", grams: "", unit: "piece", customFields: "",
  });

  const resetForm = () => {
    setForm({
      name: "", description: "", sku: "", categoryId: "",
      quantity: "0", minQuantity: "5", unitCost: "0", unitPrice: "0",
      packagingUnit: "Carton", itemsPerPackage: "1", supplierPrice: "0", expenses: "0",
      packages: "0", looseQuantity: "0",
      location: "", supplierId: "none", size: "", grams: "", unit: "piece", customFields: "",
    });
    setCalcValues(defaultCalcValues);
  };

  // AI Price Suggestions
  const priceAI = useMemo(() => {
    const cost = parseFloat(form.unitCost) || 0;
    const sale = parseFloat(form.unitPrice) || 0;
    const supPrice = parseFloat(form.supplierPrice) || 0;
    const exp = parseFloat(form.expenses) || 0;
    
    if (cost <= 0 && supPrice <= 0) return null;
    return {
      suggestions: suggestPrices(supPrice || cost, supPrice ? exp : 0).suggestedPrices,
      warning: checkBelowCost(sale, supPrice || cost, supPrice ? exp : 0)
    };
  }, [form.unitCost, form.unitPrice, form.supplierPrice, form.expenses]);

  const openEdit = (c: ComponentItem) => {
    setEditing(c);
    setForm({
      name: c.name, description: c.description || "", sku: c.sku,
      categoryId: c.category.id, quantity: String(c.quantity),
      minQuantity: String(c.minQuantity), unitCost: String(c.unitCost),
      unitPrice: String(c.unitPrice), location: c.location || "",
      packagingUnit: c.packagingUnit || "Carton", itemsPerPackage: String(c.itemsPerPackage || 1),
      supplierPrice: String(c.supplierPrice || 0), expenses: String(c.expenses || 0),
      packages: String(Math.floor(c.quantity / (c.itemsPerPackage || 1))),
      looseQuantity: String(c.quantity % (c.itemsPerPackage || 1)),
      supplierId: c.supplier?.id || "none",
      size: c.size || "", grams: c.grams ? String(c.grams) : "", 
      unit: c.unit || "piece", customFields: c.customFields || "",
    });
    setCalcValues({
      dimensionX: c.dimensionX || 0,
      dimensionY: c.dimensionY || 0,
      gsm: c.gsm || 0,
      divisor: c.divisor || 15500,
      weightKg: c.weightKg || 0,
      rimInSheet: c.rimInSheet || 100,
      ratePerKg: c.ratePerKg || 0,
      purchasePrice: c.unitCost || 0,
      salePrice: c.unitPrice || 0,
    });
  };

  const handleCreateCategory = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCategoryName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create category");
      setLocalCategories(prev => [...prev, data.category].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(prev => ({ ...prev, categoryId: data.category.id }));
      setNewCategoryName("");
      setShowAddCategory(false);
      toast.success("Category created successfully");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSearch = (term: string) => {
    const params = new URLSearchParams(window.location.search);
    if (term) params.set("search", term);
    else params.delete("search");
    params.set("page", "1");
    router.push(`/dashboard/inventory?${params.toString()}`);
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`/dashboard/inventory?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", newPage.toString());
    router.push(`/dashboard/inventory?${params.toString()}`);
  };

  const handleCreate = async () => {
    if (!form.name) { toast.error("Name is required"); return; }
    if (!form.categoryId) { toast.error("Category is required"); return; }
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
          unitCost: calcValues.purchasePrice || parseFloat(form.unitCost) || 0,
          unitPrice: calcValues.salePrice || parseFloat(form.unitPrice) || 0,
          location: form.location || undefined,
          packagingUnit: form.packagingUnit || "Carton",
          itemsPerPackage: parseInt(form.itemsPerPackage) || 1,
          supplierPrice: parseFloat(form.supplierPrice) || 0,
          expenses: parseFloat(form.expenses) || 0,
          supplierId: form.supplierId !== "none" ? form.supplierId : undefined,
          size: form.size || undefined,
          grams: parseFloat(form.grams) || undefined,
          unit: form.unit || "piece",
          customFields: form.customFields || undefined,
          dimensionX: calcValues.dimensionX || undefined,
          dimensionY: calcValues.dimensionY || undefined,
          gsm: calcValues.gsm || undefined,
          divisor: calcValues.divisor || undefined,
          weightKg: calcValues.weightKg || undefined,
          rimInSheet: calcValues.rimInSheet || undefined,
          ratePerKg: calcValues.ratePerKg || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setShowAdd(false);
      resetForm();
      toast.success("Product added");
      router.refresh();
    } catch (e: any) { toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!form.name) { toast.error("Name is required"); return; }
    if (!form.categoryId) { toast.error("Category is required"); return; }
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
          unitCost: calcValues.purchasePrice || parseFloat(form.unitCost) || 0,
          unitPrice: calcValues.salePrice || parseFloat(form.unitPrice) || 0,
          location: form.location || undefined,
          packagingUnit: form.packagingUnit || "Carton",
          itemsPerPackage: parseInt(form.itemsPerPackage) || 1,
          supplierPrice: parseFloat(form.supplierPrice) || 0,
          expenses: parseFloat(form.expenses) || 0,
          supplierId: form.supplierId !== "none" ? form.supplierId : null,
          size: form.size || undefined,
          grams: parseFloat(form.grams) || undefined,
          unit: form.unit || "piece",
          customFields: form.customFields || undefined,
          dimensionX: calcValues.dimensionX || null,
          dimensionY: calcValues.dimensionY || null,
          gsm: calcValues.gsm || null,
          divisor: calcValues.divisor || null,
          weightKg: calcValues.weightKg || null,
          rimInSheet: calcValues.rimInSheet || null,
          ratePerKg: calcValues.ratePerKg || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setEditing(null);
      toast.success("Product updated");
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
      setDeleting(null);
      toast.success("Product deleted");
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
        description="Manage paper products, stock levels, and suppliers"
        icon={Box}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print Report
            </Button>
            <Button onClick={() => { resetForm(); setShowAdd(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Product
            </Button>
          </div>
        }
      />

      <div className="space-y-6 print:hidden">
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
      <AdvancedFilter
        moduleName="inventory"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Search items, SKU, or category..." },
          { key: "categoryId", label: "Category", type: "select", placeholder: "All Categories", options: categories.map(c => ({ label: c.name, value: c.id })) },
          { key: "supplierId", label: "Supplier", type: "select", placeholder: "All Suppliers", options: suppliers.map(s => ({ label: s.name, value: s.id })) },
          { key: "stockStatus", label: "Stock", type: "select", placeholder: "All Stock", options: [
            { label: "Low Stock", value: "low" },
            { label: "Out of Stock", value: "out" },
            { label: "In Stock", value: "in" }
          ] },
        ]}
        onSearchChange={handleSearch}
      />
      <Card>
        <CardContent className="p-0">
          {components.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="No products found"
              description="Try adjusting your filters or add your first component"
              action={{ label: "Add Product", onClick: () => setShowAdd(true) }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Packaging</TableHead>
                    <TableHead className="text-right">Total Qty</TableHead>
                    <TableHead className="text-right">Sup. Price</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {components.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{c.name}</p>
                          {c.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{c.description}</p>}
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {c.size && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{c.size}</Badge>}
                            {c.grams && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{c.grams}g</Badge>}
                            {c.weightKg && c.weightKg > 0 && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400 gap-0.5">
                                <Weight className="h-2.5 w-2.5" />{c.weightKg.toFixed(2)}kg
                              </Badge>
                            )}
                            {c.dimensionX && c.dimensionY && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400">
                                {c.dimensionX}×{c.dimensionY}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm" style={{ borderColor: c.category.color, color: c.category.color }}>
                          {c.category.name}
                        </Badge>
                      </TableCell>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.sku}</code></TableCell>
                      <TableCell className="text-right text-sm">
                        <div className="font-mono">{Math.floor(c.quantity / (c.itemsPerPackage || 1))} {c.packagingUnit}</div>
                        <div className="text-[10px] text-muted-foreground">{c.quantity % (c.itemsPerPackage || 1)} loose</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <div>{c.quantity}</div>
                        {c.weightKg && c.weightKg > 0 ? (
                          <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                            {(((Math.floor(c.quantity / (c.itemsPerPackage || 1))) * c.weightKg) + ((c.quantity % (c.itemsPerPackage || 1)) / (c.rimInSheet || 100) * c.weightKg)).toFixed(2)} Kg
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(c.supplierPrice)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-600">
                        {c.weightKg && c.weightKg > 0 && c.ratePerKg && c.ratePerKg > 0 ? (
                          <div>
                            {formatCurrency(c.ratePerKg)}<span className="text-[10px] text-muted-foreground block">/kg</span>
                          </div>
                        ) : (
                          formatCurrency(c.unitCost)
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-blue-600">
                        {formatCurrency(
                          c.weightKg && c.weightKg > 0 && c.ratePerKg && c.ratePerKg > 0
                            ? (((Math.floor(c.quantity / (c.itemsPerPackage || 1)) * c.weightKg) + ((c.quantity % (c.itemsPerPackage || 1)) / (c.rimInSheet || 100) * c.weightKg)) * c.ratePerKg)
                            : (c.quantity / (c.itemsPerPackage || 1)) * c.unitCost
                        )}
                      </TableCell>
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
        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing page {pagination.page} of {pagination.totalPages} ({pagination.totalRecords} components)
            </p>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handlePageChange(pagination.page - 1)} 
                disabled={pagination.page <= 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-sm font-medium">Page {pagination.page}</span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handlePageChange(pagination.page + 1)} 
                disabled={pagination.page >= pagination.totalPages}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
      </div>

      {/* Dedicated Print View (Hidden on screen, visible on print) */}
      <div className="hidden print:block">
        <div className="flex justify-between items-end mb-6 border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Inventory Stock Value Report</h1>
            <p className="text-sm text-slate-500 mt-1">Generated: {formatDate(new Date().toISOString())}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">{COMPANY_INFO?.name || "Company"}</p>
          </div>
        </div>

        <table className="w-full text-sm text-left">
          <thead className="border-b-2 border-slate-800">
            <tr>
              <th className="py-2 px-1 text-slate-900 font-semibold">ID</th>
              <th className="py-2 px-1 text-slate-900 font-semibold">Product Name</th>
              <th className="py-2 px-1 text-right text-slate-900 font-semibold">C IN Q</th>
              <th className="py-2 px-1 text-right text-slate-900 font-semibold">Catan</th>
              <th className="py-2 px-1 text-right text-slate-900 font-semibold">Qty</th>
              <th className="py-2 px-1 text-right text-slate-900 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {components.map((c, i) => (
              <tr key={c.id}>
                <td className="py-1.5 px-1 font-mono text-xs">{i + 1}</td>
                <td className="py-1.5 px-1 font-medium">{c.name} {c.size ? `(${c.size})` : ''}</td>
                <td className="py-1.5 px-1 text-right font-mono">{c.itemsPerPackage || 1}</td>
                <td className="py-1.5 px-1 text-right font-mono">{Math.floor(c.quantity / (c.itemsPerPackage || 1)) || "-"}</td>
                <td className="py-1.5 px-1 text-right font-mono">{c.quantity % (c.itemsPerPackage || 1) || "-"}</td>
                <td className="py-1.5 px-1 text-right font-mono font-semibold">{formatCurrency(c.quantity * c.unitCost)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-800 bg-slate-50 font-bold">
              <td colSpan={5} className="py-2 px-1 text-right">Total Inventory Value:</td>
              <td className="py-2 px-1 text-right font-mono">{formatCurrency(components.reduce((sum, c) => sum + (c.quantity * c.unitCost), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={showAdd || !!editing} onClose={() => { setShowAdd(false); setEditing(null); }}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle>
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
              {showAddCategory ? (
                <div className="flex items-center gap-1.5 h-10">
                  <Input 
                    value={newCategoryName} 
                    onChange={e => setNewCategoryName(e.target.value)} 
                    placeholder="Category Name" 
                    className="flex-1 h-10"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }}
                  />
                  <Button type="button" size="sm" onClick={handleCreateCategory} disabled={!newCategoryName.trim() || creatingCategory} className="px-2.5 shrink-0">
                    {creatingCategory ? "..." : "Save"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowAddCategory(false)} className="px-2.5 shrink-0">
                    Cancel
                  </Button>
                </div>
              ) : (
                <Select value={form.categoryId} onChange={v => {
                  if (v === "add_new_category") setShowAddCategory(true);
                  else setForm({...form, categoryId: v});
                }}>
                  <SelectTrigger>
                    <span className={`flex-1 text-left truncate ${!form.categoryId ? "text-muted-foreground" : ""}`}>
                      {localCategories.find(c => c.id === form.categoryId)?.name || "Select category"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {localCategories.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                    <SelectItem value="add_new_category" className="text-primary font-medium border-t mt-1 pt-1.5 cursor-pointer">
                      + Add New Category
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={form.supplierId} onChange={v => setForm({...form, supplierId: v})}>
                <SelectTrigger>
                  <span className={`flex-1 text-left truncate ${form.supplierId === "none" ? "text-muted-foreground" : ""}`}>
                    {form.supplierId === "none" ? "None" : suppliers.find(s => s.id === form.supplierId)?.name || "None"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3 pt-2 border-t mt-2">
            <h4 className="text-sm font-medium">Packaging & Stock</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Packaging Unit</Label>
                <Input value={form.packagingUnit} onChange={e => setForm({...form, packagingUnit: e.target.value})} placeholder="e.g. Carton, Bottle, Ream" />
              </div>
              <div className="space-y-1">
                <Label>Items per {form.packagingUnit || "Package"}</Label>
                <Input type="number" min="1" value={form.itemsPerPackage} onChange={e => {
                  const itemsPerPkg = parseInt(e.target.value) || 1;
                  const pkgs = parseInt(form.packages) || 0;
                  const loose = parseInt(form.looseQuantity) || 0;
                  setForm({...form, itemsPerPackage: e.target.value, quantity: String(pkgs * itemsPerPkg + loose)});
                }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>{form.packagingUnit || "Packages"} (Stock)</Label>
                <Input type="number" value={form.packages} onChange={e => {
                  const pkgs = parseInt(e.target.value) || 0;
                  const itemsPerPkg = parseInt(form.itemsPerPackage) || 1;
                  const loose = parseInt(form.looseQuantity) || 0;
                  setForm({...form, packages: e.target.value, quantity: String(pkgs * itemsPerPkg + loose)});
                }} />
              </div>
              <div className="space-y-1">
                <Label>Loose Qty</Label>
                <Input type="number" value={form.looseQuantity} onChange={e => {
                  const loose = parseInt(e.target.value) || 0;
                  const itemsPerPkg = parseInt(form.itemsPerPackage) || 1;
                  const pkgs = parseInt(form.packages) || 0;
                  setForm({...form, looseQuantity: e.target.value, quantity: String(pkgs * itemsPerPkg + loose)});
                }} />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <Label>Total Qty</Label>
                  {calcValues.weightKg > 0 && (
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {(((parseInt(form.packages) || 0) * calcValues.weightKg) + ((parseInt(form.looseQuantity) || 0) / (calcValues.rimInSheet || 100) * calcValues.weightKg)).toFixed(2)} Kg
                    </span>
                  )}
                </div>
                <Input type="number" value={form.quantity} onChange={e => {
                  const qty = parseInt(e.target.value) || 0;
                  const itemsPerPkg = parseInt(form.itemsPerPackage) || 1;
                  setForm({...form, quantity: String(qty), packages: String(Math.floor(qty / itemsPerPkg)), looseQuantity: String(qty % itemsPerPkg)});
                }} />
              </div>
            </div>
            <div className="flex gap-4">
              <div className="space-y-1 w-1/2">
                <Label>Min Quantity Alert (Total)</Label>
                <Input type="number" value={form.minQuantity} onChange={e => setForm({...form, minQuantity: e.target.value})} />
              </div>
              <div className="space-y-1 w-1/2">
                <Label>Total Amount</Label>
                <div className="h-10 px-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900 rounded-md flex items-center justify-end font-semibold text-indigo-700 dark:text-indigo-400 font-mono tabular-nums">
                  {formatCurrency(
                     calcValues.weightKg > 0 && calcValues.ratePerKg > 0 
                     ? (((parseInt(form.packages) || 0) * calcValues.weightKg) + ((parseInt(form.looseQuantity) || 0) / (calcValues.rimInSheet || 100) * calcValues.weightKg)) * calcValues.ratePerKg
                     : (parseInt(form.quantity) || 0) / (parseInt(form.itemsPerPackage) || 1) * (parseFloat(form.unitCost) || 0)
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Price Calculator */}
          <div className="pt-2 border-t mt-2">
            <PriceCalculator
              values={calcValues}
              onChange={(newVals) => {
                setCalcValues(newVals);
                const updates: any = {};
                
                // Sync calculator prices with form
                if (newVals.purchasePrice !== calcValues.purchasePrice) {
                  updates.unitCost = String(newVals.purchasePrice);
                }
                if (newVals.salePrice !== calcValues.salePrice) {
                  updates.unitPrice = String(newVals.salePrice);
                }
                
                // Auto-suggest size and grams from dimensions
                if (newVals.dimensionX > 0 && newVals.dimensionY > 0) {
                  updates.size = `${newVals.dimensionX}x${newVals.dimensionY}`;
                }
                if (newVals.gsm > 0) {
                  updates.grams = String(newVals.gsm);
                }
                
                if (Object.keys(updates).length > 0) {
                  setForm(prev => ({ ...prev, ...updates }));
                }
              }}
              compact
              showSalePrice={true}
            />
          </div>

          <div className="space-y-3 pt-2 border-t mt-2">
            <h4 className="text-sm font-medium">Additional Pricing</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Supplier Price (Rs.)</Label>
                <Input type="number" step="0.01" value={form.supplierPrice} onChange={e => {
                  const sup = parseFloat(e.target.value) || 0;
                  const exp = parseFloat(form.expenses) || 0;
                  setForm({...form, supplierPrice: e.target.value, unitCost: String(sup + exp)});
                }} />
              </div>
              <div className="space-y-1">
                <Label>Expenses (Rs.)</Label>
                <Input type="number" step="0.01" value={form.expenses} onChange={e => {
                  const exp = parseFloat(e.target.value) || 0;
                  const sup = parseFloat(form.supplierPrice) || 0;
                  setForm({...form, expenses: e.target.value, unitCost: String(sup + exp)});
                }} />
              </div>
            </div>

            {/* AI Price Insights */}
            {priceAI && priceAI.suggestions.length > 0 && (
              <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700 dark:text-purple-400">
                  <Sparkles className="h-3.5 w-3.5" /> AI Price Suggestions
                </div>
                <div className="flex flex-wrap gap-2">
                  {priceAI.suggestions.map((sug, i) => (
                    <Badge 
                      key={i} 
                      variant="outline" 
                      className="cursor-pointer bg-white dark:bg-black hover:bg-purple-100 hover:text-purple-800 transition-colors"
                      onClick={() => {
                        setForm({ ...form, unitPrice: String(sug.price) });
                        setCalcValues(prev => ({ ...prev, salePrice: sug.price }));
                      }}
                    >
                      {sug.label}: Rs. {sug.price.toLocaleString()}
                    </Badge>
                  ))}
                </div>
                {priceAI.warning.isBelow && (
                  <div className="flex items-start gap-1.5 text-xs font-medium text-red-600 mt-2 bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-200 dark:border-red-900">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{priceAI.warning.message}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Location</Label>
            <Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="e.g. Shelf A-3" />
          </div>
          
          {/* New Fields */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t mt-2">
            <div className="space-y-1">
              <Label>Size/Dimensions</Label>
              <Input value={form.size} onChange={e => setForm({...form, size: e.target.value})} placeholder="e.g. 14 inch" />
            </div>
            <div className="space-y-1">
              <Label>Weight (Grams)</Label>
              <Input type="number" step="0.1" value={form.grams} onChange={e => setForm({...form, grams: e.target.value})} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label>Unit of Measure</Label>
              <Select value={form.unit} onChange={v => setForm({...form, unit: v})}>
                <SelectTrigger>
                  <span className="flex-1 text-left truncate">
                    {form.unit === "piece" ? "Piece (pc)" :
                     form.unit === "sheet" ? "Sheet" :
                     form.unit === "meter" ? "Meter (m)" :
                     form.unit === "kg" ? "Kilogram (kg)" :
                     form.unit === "set" ? "Set" : form.unit}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="piece">Piece (pc)</SelectItem>
                  <SelectItem value="sheet">Sheet</SelectItem>
                  <SelectItem value="meter">Meter (m)</SelectItem>
                  <SelectItem value="kg">Kilogram (kg)</SelectItem>
                  <SelectItem value="set">Set</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Custom Fields (JSON format)</Label>
            <Textarea value={form.customFields} onChange={e => setForm({...form, customFields: e.target.value})} rows={2} placeholder='e.g. {"color": "red", "brand": "XYZ"}' />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
          <Button onClick={editing ? handleUpdate : handleCreate} disabled={loading}>
            {loading ? "Saving..." : editing ? "Save Changes" : "Add Product"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)} onConfirm={handleDelete}
        title="Delete Product"
        description={`Are you sure you want to delete "${deleting?.name}"? This action cannot be undone.`}
        variant="destructive"
        loading={loading}
      />
    </div>
  );
}