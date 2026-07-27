"use client";

import { useState, useMemo } from "react";
import { Plus, TrendingDown, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EXPENDITURE_CATEGORIES } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";

interface ExpenditureItem {
  id: string; category: string; amount: number; description: string;
  date: string; accountId: string | null; createdAt: string;
}

interface Props {
  expenditures: ExpenditureItem[];
  accounts: { id: string; name: string; type: string }[];
  categoryBreakdown: { category: string; total: number; count: number }[];
  totalExpense: number;
}

export default function ExpendituresClient({ expenditures: initialData, accounts, categoryBreakdown, totalExpense }: Props) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: "", amount: "", description: "", date: new Date().toISOString().split("T")[0], accountId: "" });
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return initialData.filter(e => {
      if (search && !e.description.toLowerCase().includes(search.toLowerCase())) return false;
      if (catFilter !== "all" && e.category !== catFilter) return false;
      return true;
    });
  }, [initialData, search, catFilter]);

  const resetForm = () => setForm({ category: "", amount: "", description: "", date: new Date().toISOString().split("T")[0], accountId: "" });

  const handleCreate = async () => {
    if (!form.amount || !form.description || !form.category) { toast.error("All fields required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/expenditures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount), date: new Date(form.date) }),
      });
      const data = await res.json();
      if (data.success) { toast.success("Expenditure recorded"); resetForm(); setShowAdd(false); window.location.reload(); }
      else toast.error(data.error);
    } catch { toast.error("Network error"); }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { await fetch(`/api/expenditures/${deleteId}`, { method: "DELETE" }); toast.success("Deleted"); setDeleteId(null); window.location.reload(); }
    catch { toast.error("Failed"); }
    setDeleting(false);
  };

  const getCatLabel = (val: string) => EXPENDITURE_CATEGORIES.find(c => c.value === val)?.label || val;

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Expenditures" description="Track daily shop expenses — rent, salaries, miscellaneous" icon={TrendingDown}
        actions={<Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" /> Add Expense</Button>} />

      {/* Category Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Expenses</p>
            <p className="text-xl font-bold text-red-500">{formatCurrency(totalExpense)}</p>
          </CardContent>
        </Card>
        {categoryBreakdown.slice(0, 3).map((cat, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{getCatLabel(cat.category)}</p>
              <p className="text-lg font-bold">{formatCurrency(cat.total)}</p>
              <p className="text-xs text-muted-foreground">{cat.count} entries</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-64">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by description..." />
        </div>
        <Select value={catFilter} onChange={setCatFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {EXPENDITURE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={TrendingDown} title="No expenditures" description="Record your first expense" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(exp => (
                  <TableRow key={exp.id}>
                    <TableCell className="text-muted-foreground">{formatDate(exp.date)}</TableCell>
                    <TableCell><Badge variant="secondary">{getCatLabel(exp.category)}</Badge></TableCell>
                    <TableCell>{exp.description}</TableCell>
                    <TableCell className="text-right font-semibold text-red-500">{formatCurrency(exp.amount)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(exp.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onClose={() => { resetForm(); setShowAdd(false); }}>
        <div className="space-y-4 p-4">
          <DialogHeader><DialogTitle>Record Expenditure</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onChange={v => setForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {EXPENDITURE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (PKR) *</Label>
              <Input type="number" step="1" min="1" placeholder="Enter amount" value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Description *</Label>
              <Input placeholder="What was this expense for?" value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            {accounts.length > 0 && (
              <div>
                <Label>Paid From Account</Label>
                <Select value={form.accountId} onChange={v => setForm(p => ({ ...p, accountId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select account (optional)" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowAdd(false); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Recording..." : "Record Expense"}</Button>
          </DialogFooter>
        </div>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Delete Expenditure" description="This will permanently delete this expense record." />
    </div>
  );
}
