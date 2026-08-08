"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Building2, Search, Trash2, Edit, Phone, Mail, MapPin, Truck, AlertTriangle, Printer, Eye, Filter, FileText, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { findDuplicates, type DuplicateMatch } from "@/lib/ai-engine";
import { AdvancedFilter } from "@/components/shared/advanced-filter";
import { Pagination } from "@/components/shared/pagination";

interface SupplierItem {
  id: string; name: string; company: string | null;
  email: string | null; phone: string | null;
  address: string | null; city: string | null; country: string;
  taxNumber: string | null; notes: string | null;
  totalPurchased: number; balanceDue: number;
  isActive: boolean;
  createdAt: string; updatedAt: string;
  _count: { purchases: number; components: number };
}



interface Props { 
  suppliers: SupplierItem[]; 
  pagination: { page: number; totalPages: number; totalRecords: number };
}

const emptyForm = { name: "", company: "", email: "", phone: "", city: "", country: "Pakistan", address: "", taxNumber: "", notes: "" };

export default function SuppliersClient({ suppliers: initialSuppliers, pagination }: Props) {
  const [search, setSearch] = useState(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("search") || "" : "");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<SupplierItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const handleSearch = (term: string) => {
    setSearch(term);
    const params = new URLSearchParams(window.location.search);
    if (term) params.set("search", term);
    else params.delete("search");
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  const duplicates = useMemo(() => {
    if (!!editing || !form.name.trim()) return [];
    return findDuplicates(form.name, form.phone, initialSuppliers);
  }, [form.name, form.phone, initialSuppliers, editing]);

  const totalPurchased = initialSuppliers.reduce((s, sup) => s + sup.totalPurchased, 0);
  const totalBalanceDue = initialSuppliers.reduce((s, sup) => s + sup.balanceDue, 0);

  const resetForm = () => setForm(emptyForm);

  const openEdit = (s: SupplierItem) => {
    setEditing(s);
    setForm({
      name: s.name, company: s.company || "", email: s.email || "", phone: s.phone || "",
      city: s.city || "", country: s.country || "Pakistan", address: s.address || "",
      taxNumber: s.taxNumber || "", notes: s.notes || "",
    });
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Supplier name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, company: form.company || undefined, email: form.email || undefined,
          phone: form.phone || undefined, city: form.city || undefined, country: form.country || undefined,
          address: form.address || undefined, taxNumber: form.taxNumber || undefined,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Supplier added");
      setShowAdd(false);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const handleUpdate = async () => {
    if (!editing || !form.name.trim()) { toast.error("Supplier name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/suppliers/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, company: form.company || null, email: form.email || null,
          phone: form.phone || null, city: form.city || null, country: form.country || null,
          address: form.address || null, taxNumber: form.taxNumber || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Supplier updated");
      setEditing(null);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/suppliers/${deleteId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Supplier deleted");
      setDeleteId(null);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setDeleting(false); }
  };

  const isEditing = !!editing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Manage paper suppliers, purchase history, and due balances"
        icon={Truck}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print Report
            </Button>
            <Button onClick={() => { resetForm(); setShowAdd(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Supplier
            </Button>
          </div>
        }
      />

      <div className="space-y-6 print:hidden">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600"><Truck className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Suppliers</p>
              <p className="text-xl font-bold">{initialSuppliers.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><Building2 className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Purchased</p>
              <p className="text-xl font-bold">{formatCurrency(totalPurchased)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600"><Phone className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">P.O. Count</p>
              <p className="text-xl font-bold">{initialSuppliers.reduce((s, sup) => s + sup._count.purchases, 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-red-100 dark:bg-red-900/30 text-red-600"><MapPin className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Balance Due</p>
              <p className="text-xl font-bold">{formatCurrency(totalBalanceDue)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <AdvancedFilter
        moduleName="suppliers"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Search supplier by name, company, city, phone..." },
          { key: "balance", label: "Balance", type: "select", placeholder: "All Balances", options: [
            { label: "Has Balance Due", value: "pending" },
            { label: "Settled / Zero", value: "settled" }
          ] },
          { key: "status", label: "Status", type: "select", placeholder: "All Status", options: [
            { label: "Active Only", value: "active" },
            { label: "Inactive Only", value: "inactive" }
          ] },
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
        ]}
        onSearchChange={handleSearch}
      />

      <Card>
        <CardContent className="p-0">
          {initialSuppliers.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No suppliers found"
              description={search ? "Try adjusting your search" : "Add your first supplier"}
              action={search ? undefined : { label: "Add Supplier", onClick: () => setShowAdd(true) }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead className="text-right">Total Purchased</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-center">P.O. #</TableHead>
                    <TableHead className="text-center">Products</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialSuppliers.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.company || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-sm">
                          {s.email && <span className="text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{s.email}</span>}
                          {s.phone && <span className="text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{s.phone}</span>}
                        </div>
                      </TableCell>
                      <TableCell>{s.city || "—"}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.totalPurchased)}</TableCell>
                      <TableCell className="text-right">
                        <span className={s.balanceDue > 0 ? "text-red-600 font-medium" : ""}>{formatCurrency(s.balanceDue)}</span>
                      </TableCell>
                      <TableCell className="text-center">{s._count.purchases}</TableCell>
                      <TableCell className="text-center">{s._count.components}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(s)}>
                                <Edit className="h-4 w-4 mr-2" /> Edit Supplier
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/dashboard/suppliers/${s.id}/ledger`)}>
                                <Eye className="h-4 w-4 mr-2" /> View Ledger
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/dashboard/suppliers/${s.id}/statement`)}>
                                <FileText className="h-4 w-4 mr-2" /> View Statement
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(s.id)}>
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {pagination.totalPages > 1 && (
        <div className="py-4">
          <Pagination 
            currentPage={pagination.page} 
            totalPages={pagination.totalPages} 
            onPageChange={(p: number) => {
              const params = new URLSearchParams(window.location.search);
              params.set("page", p.toString());
              router.push(`?${params.toString()}`);
            }}
          />
        </div>
      )}
      </div>



      <Dialog open={showAdd || isEditing} onClose={() => { setShowAdd(false); setEditing(null); }}>
        <DialogHeader><DialogTitle>{isEditing ? "Edit Supplier" : "Add Supplier"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Supplier name" />
            </div>
            <div className="space-y-1">
              <Label>Company</Label>
              <Input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Company name" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" type="email" />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+92 300 1234567" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>City</Label>
              <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" />
            </div>
            <div className="space-y-1">
              <Label>Country</Label>
              <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="Pakistan" />
            </div>
            <div className="space-y-1">
              <Label>Tax Number</Label>
              <Input value={form.taxNumber} onChange={e => setForm({ ...form, taxNumber: e.target.value })} placeholder="NTN / STRN" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Address</Label>
            <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" />
          </div>

          {/* Duplicate Warnings */}
          {!isEditing && duplicates.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 font-medium text-sm">
                <AlertTriangle className="h-4 w-4" />
                Potential Duplicates Detected
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground ml-6">
                {duplicates.map(dup => (
                  <li key={dup.id} className="list-disc">
                    <strong>{dup.name}</strong> {dup.phone && `(${dup.phone})`} 
                    <Badge variant="outline" className="ml-2 text-[10px] h-4">
                      {dup.matchType === "phone" ? "Phone Match" : `${dup.similarity}% match`}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-600/80 ml-6">Are you sure you want to add this supplier?</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
          <Button onClick={isEditing ? handleUpdate : handleCreate} disabled={submitting}>
            {submitting ? "Saving..." : isEditing ? "Update" : "Add Supplier"}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Supplier"
        description="Are you sure you want to delete this supplier? This cannot be undone."
      />
    </div>
  );
}