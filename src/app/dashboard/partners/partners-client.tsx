"use client";

import { useState, useMemo } from "react";
import { Plus, Users, Search, Trash2, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";

interface PartnerItem {
  id: string; name: string; email: string | null; phone: string | null;
  investmentAmount: number; profitSharePercent: number;
  totalWithdrawals: number; currentBalance: number;
  notes: string | null; isActive: boolean;
}

interface Props { partners: PartnerItem[]; }

export default function PartnersClient({ partners: initialPartners }: Props) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", investmentAmount: "0", profitSharePercent: "0", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return initialPartners;
    const q = search.toLowerCase();
    return initialPartners.filter(p => p.name.toLowerCase().includes(q) || (p.email && p.email.toLowerCase().includes(q)));
  }, [initialPartners, search]);

  const totalInvestment = initialPartners.reduce((s, p) => s + p.investmentAmount, 0);
  const totalProfitShare = initialPartners.reduce((s, p) => s + p.profitSharePercent, 0);

  const resetForm = () => setForm({ name: "", email: "", phone: "", investmentAmount: "0", profitSharePercent: "0", notes: "" });

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Partner name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, email: form.email || undefined, phone: form.phone || undefined,
          investmentAmount: parseFloat(form.investmentAmount) || 0,
          profitSharePercent: parseFloat(form.profitSharePercent) || 0,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Partner added");
      setShowAdd(false);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/partners/${deleteId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Partner removed");
      setDeleteId(null);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setDeleting(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partners"
        description="Manage business partners, investments, and profit sharing"
        icon={Users}
        actions={
          <Button onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Partner
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600"><Users className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Partners</p>
              <p className="text-xl font-bold">{initialPartners.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><TrendingUp className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Investment</p>
              <p className="text-xl font-bold">{formatCurrency(totalInvestment)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600"><Wallet className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Profit Share</p>
              <p className="text-xl font-bold">{totalProfitShare}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search partners..." className="max-w-sm" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={Users}
              title="No partners found"
              description={search ? "Try adjusting your search" : "Add your first business partner"}
              action={search ? undefined : { label: "Add Partner", onClick: () => setShowAdd(true) }}
            />
          </div>
        ) : (
          filtered.map(p => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">{p.name}</CardTitle>
                <Badge variant={p.isActive ? "success" : "secondary"}>{p.isActive ? "Active" : "Inactive"}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {p.email && <p className="text-muted-foreground">{p.email}</p>}
                {p.phone && <p className="text-muted-foreground">{p.phone}</p>}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground">Investment</p>
                    <p className="font-semibold">{formatCurrency(p.investmentAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Profit Share</p>
                    <p className="font-semibold">{p.profitSharePercent}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Withdrawals</p>
                    <p className="font-semibold">{formatCurrency(p.totalWithdrawals)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Balance</p>
                    <p className="font-semibold text-emerald-600">{formatCurrency(p.currentBalance)}</p>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(p.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <DialogHeader><DialogTitle>Add Partner</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Partner name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="03XX-XXXXXXX" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Investment (PKR)</Label><Input type="number" value={form.investmentAmount} onChange={e => setForm({ ...form, investmentAmount: e.target.value })} /></div>
            <div className="space-y-1"><Label>Profit Share %</Label><Input type="number" min="0" max="100" value={form.profitSharePercent} onChange={e => setForm({ ...form, profitSharePercent: e.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={deleting}
        title="Remove Partner" description="This will permanently delete this partner. This action cannot be undone."
        confirmLabel="Remove" variant="destructive"
      />
    </div>
  );
}