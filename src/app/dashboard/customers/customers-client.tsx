"use client";

import { useState, useMemo } from "react";
import { Plus, Users, Search, Trash2, Edit, Phone, Mail, MapPin, AlertTriangle, Wallet, FileText, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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

interface CustomerItem {
  id: string; name: string; email: string | null; phone: string | null;
  address: string | null; city: string | null;
  totalPurchased: number; visitCount: number;
  notes: string | null; isActive: boolean;
  createdAt: string; updatedAt: string;
  _count: { sales: number };
}



interface Props { 
  customers: CustomerItem[];
  pagination: { page: number; totalPages: number; totalRecords: number };
}

const emptyForm = { name: "", email: "", phone: "", city: "", address: "", notes: "" };

export default function CustomersClient({ customers: initialCustomers, pagination }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("search") || "" : "");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CustomerItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    return findDuplicates(form.name, form.phone, initialCustomers);
  }, [form.name, form.phone, initialCustomers, editing]);

  const totalRevenue = initialCustomers.reduce((s, c) => s + c.totalPurchased, 0);

  const resetForm = () => setForm(emptyForm);

  const openEdit = (c: CustomerItem) => {
    setEditing(c);
    setForm({ name: c.name, email: c.email || "", phone: c.phone || "", city: c.city || "", address: c.address || "", notes: c.notes || "" });
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Customer name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email || undefined, phone: form.phone || undefined, city: form.city || undefined, address: form.address || undefined }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Customer added");
      setShowAdd(false);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const handleUpdate = async () => {
    if (!editing || !form.name.trim()) { toast.error("Customer name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email || null, phone: form.phone || null, city: form.city || null, address: form.address || null, notes: form.notes || null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Customer updated");
      setEditing(null);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/customers/${deleteId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Customer deleted");
      setDeleteId(null);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setDeleting(false); }
  };

  const isEditing = !!editing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Manage registered customers and their purchase history"
        icon={Users}
        actions={
          <Button onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Customer
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600"><Users className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Customers</p>
              <p className="text-xl font-bold">{initialCustomers.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><MapPin className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="text-xl font-bold">{formatCurrency(totalRevenue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600"><Phone className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Sales Orders</p>
              <p className="text-xl font-bold">{initialCustomers.reduce((s, c) => s + c._count.sales, 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <AdvancedFilter
        moduleName="customers"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Search customer by name, email, phone, city..." },
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
          {initialCustomers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No customers found"
              description={search ? "Try adjusting your search" : "Add your first customer"}
              action={search ? undefined : { label: "Add Customer", onClick: () => setShowAdd(true) }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead className="text-right">Total Purchased</TableHead>
                    <TableHead className="text-center">Orders</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialCustomers.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-sm">
                          {c.email && <span className="text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                          {c.phone && <span className="text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                        </div>
                      </TableCell>
                      <TableCell>{c.city || "—"}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(c.totalPurchased)}</TableCell>
                      <TableCell className="text-center">{c._count.sales}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(c)}>
                                <Edit className="h-4 w-4 mr-2" /> Edit Customer
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/dashboard/customers/${c.id}/statement`)}>
                                <FileText className="h-4 w-4 mr-2" /> View Statement
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(c.id)}>
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

      <Dialog open={showAdd || isEditing} onClose={() => { setShowAdd(false); setEditing(null); }}>
        <DialogHeader><DialogTitle>{isEditing ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Customer name" />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>City</Label>
              <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" />
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
            </div>
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
              <p className="text-xs text-amber-600/80 ml-6">Are you sure you want to add this customer?</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
          <Button onClick={isEditing ? handleUpdate : handleCreate} disabled={submitting}>
            {submitting ? "Saving..." : isEditing ? "Update" : "Add Customer"}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Customer"
        description="Are you sure you want to delete this customer? This cannot be undone."
      />
    </div>
  );
}