"use client";

import { useState, useMemo } from "react";
import {
  Plus, DollarSign, TrendingUp, TrendingDown, Wallet,
  FileText, Search, Banknote, Smartphone, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency, formatDate, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

interface FinanceRecord {
  id: string; transactionRef: string; type: "INCOME" | "EXPENSE";
  category: string; amount: number; description: string;
  paymentMethod: string | null; reference: string | null;
  date: string; createdAt: string;
  user: { name: string };
}

interface Props {
  records: FinanceRecord[];
  summary: { totalIncome: number; totalExpense: number; netProfit: number };
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  CASH: Banknote, BANK_TRANSFER: Banknote,
  JAZZCASH: Smartphone, EASYPAISA: Smartphone,
  NAYAPAY: Smartphone, SADAPAY: Smartphone,
};

const ALL_CATEGORIES = [
  ...INCOME_CATEGORIES.map(c => ({ ...c, type: "INCOME" as const })),
  ...EXPENSE_CATEGORIES.map(c => ({ ...c, type: "EXPENSE" as const })),
];

export default function FinanceClient({ records: initialRecords, summary }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Add dialog
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ type: "INCOME", category: "", amount: "", description: "", paymentMethod: "", reference: "", date: new Date().toISOString().split("T")[0] });
  const [submitting, setSubmitting] = useState(false);

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return initialRecords.filter(r => {
      if (search && !r.description.toLowerCase().includes(search.toLowerCase()) && !r.transactionRef.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      return true;
    });
  }, [initialRecords, search, typeFilter, categoryFilter]);

  const resetForm = () => setForm({ type: "INCOME", category: "", amount: "", description: "", paymentMethod: "", reference: "", date: new Date().toISOString().split("T")[0] });

  const handleCreate = async () => {
    if (!form.amount || !form.description || !form.category) { toast.error("Amount, description, and category are required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          category: form.category,
          amount: parseFloat(form.amount),
          description: form.description,
          paymentMethod: form.paymentMethod || undefined,
          reference: form.reference || undefined,
          date: new Date(form.date),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Record added");
      setShowAdd(false);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/finance/${deleteId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Record deleted");
      setDeleteId(null);
      window.location.reload();
    } catch (err: any) { toast.error(err.message); }
    finally { setDeleting(false); }
  };

  const categories = form.type === "INCOME" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Track income, expenses, and cash flow"
        icon={DollarSign}
        actions={
          <Button onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Record
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><TrendingUp className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Income</p>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary.totalIncome)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-red-100 dark:bg-red-900/30 text-red-600"><TrendingDown className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Expenses</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(summary.totalExpense)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`rounded-full p-2 ${summary.netProfit >= 0 ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600" : "bg-red-100 dark:bg-red-900/30 text-red-600"}`}>
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net Profit</p>
              <p className={`text-xl font-bold ${summary.netProfit >= 0 ? "text-blue-600" : "text-red-600"}`}>{formatCurrency(summary.netProfit)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search transactions..." className="flex-1" />
            <Select value={typeFilter} onChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-32"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {ALL_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No finance records"
              description={search || typeFilter !== "all" || categoryFilter !== "all" ? "Try adjusting filters" : "Start tracking income and expenses"}
              action={search || typeFilter !== "all" || categoryFilter !== "all" ? undefined : { label: "Add Record", onClick: () => setShowAdd(true) }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const cat = ALL_CATEGORIES.find(c => c.value === r.category);
                    const paymentIcon = r.paymentMethod ? (PAYMENT_ICONS[r.paymentMethod] || Banknote) : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.transactionRef}</TableCell>
                        <TableCell>
                          <Badge variant={r.type === "INCOME" ? "success" : "destructive"}>{r.type}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{cat?.label || r.category}</span>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{r.description}</TableCell>
                        <TableCell>
                          {(() => { const PaymentIcon = paymentIcon; return PaymentIcon ? <PaymentIcon className="h-3.5 w-3.5 text-muted-foreground" /> : null; })()}
                        </TableCell>
                        <TableCell className={`text-right font-semibold tabular-nums ${r.type === "INCOME" ? "text-emerald-600" : "text-red-600"}`}>
                          {r.type === "EXPENSE" ? "-" : ""}{formatCurrency(r.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <DialogHeader><DialogTitle>Add Finance Record</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={form.type} onChange={v => { setForm({ ...form, type: v, category: "" }); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={form.category} onChange={v => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount (PKR)</Label>
            <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input placeholder="What was this for?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Method</Label>
              <Select value={form.paymentMethod} onChange={v => setForm({ ...form, paymentMethod: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Reference (optional)</Label>
            <Input placeholder="e.g. INV-0001" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Saving..." : "Save Record"}</Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Finance Record"
        description="This will permanently delete this transaction. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}