"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, Receipt, Search, Trash2, Zap, Calendar, DollarSign, Users, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import PriceCalculator, { type PriceCalcValues, defaultCalcValues } from "@/components/shared/price-calculator";

interface CashSaleItem {
  id: string; receiptNo: string; customerName: string | null;
  date: string; amount: number; remarks: string | null;
  paymentMethod: string; createdAt: string;
}

interface Props {
  sales: CashSaleItem[];
  todayStats: { total: number; count: number };
  allStats: { total: number; count: number };
}

export default function CashSalesClient({ sales: initialSales, todayStats, allStats }: Props) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ customerName: "", amount: "", remarks: "", paymentMethod: "CASH" });
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const [showCalc, setShowCalc] = useState(false);
  const [calcValues, setCalcValues] = useState<PriceCalcValues>(defaultCalcValues);

  // Auto-focus amount field when dialog opens for fast entry
  useEffect(() => {
    if (showAdd && amountRef.current) {
      setTimeout(() => amountRef.current?.focus(), 100);
    }
  }, [showAdd]);

  const filtered = useMemo(() => {
    if (!search) return initialSales;
    const q = search.toLowerCase();
    return initialSales.filter(s =>
      (s.customerName && s.customerName.toLowerCase().includes(q)) ||
      s.receiptNo.toLowerCase().includes(q) ||
      (s.remarks && s.remarks.toLowerCase().includes(q))
    );
  }, [initialSales, search]);

  const resetForm = () => {
    setForm({ customerName: "", amount: "", remarks: "", paymentMethod: "CASH" });
    setShowCalc(false);
    setCalcValues(defaultCalcValues);
  };

  const handleCreate = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error("Amount is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/cash-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Cash Sale ${data.sale.receiptNo} created!`);
        resetForm();
        setShowAdd(false);
        window.location.reload();
      } else {
        toast.error(data.error || "Failed to create cash sale");
      }
    } catch { toast.error("Network error"); }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await fetch(`/api/cash-sales/${deleteId}`, { method: "DELETE" });
      toast.success("Cash sale deleted");
      setDeleteId(null);
      window.location.reload();
    } catch { toast.error("Failed to delete"); }
    setDeleting(false);
  };

  // Handle Enter key for fast checkout
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !submitting && form.amount) {
      handleCreate();
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Cash Sales"
        description="Quick counter sales — fast checkout for shop operations"
        icon={Receipt}
        actions={
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <Zap className="h-4 w-4" /> Quick Sale
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20"><DollarSign className="h-5 w-5 text-emerald-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Today's Sales</p>
                <p className="text-xl font-bold text-emerald-500">{formatCurrency(todayStats.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20"><Receipt className="h-5 w-5 text-blue-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Today's Count</p>
                <p className="text-xl font-bold text-blue-500">{todayStats.count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 border-violet-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/20"><DollarSign className="h-5 w-5 text-violet-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">All Time Sales</p>
                <p className="text-xl font-bold text-violet-500">{formatCurrency(allStats.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20"><Receipt className="h-5 w-5 text-amber-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Total Receipts</p>
                <p className="text-xl font-bold text-amber-500">{allStats.count}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <SearchInput value={search} onChange={setSearch} placeholder="Search by name, receipt #, or remarks..." />

      {/* Sales Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="No cash sales yet" description="Create your first quick sale to get started" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(sale => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-mono font-medium text-blue-500">{sale.receiptNo}</TableCell>
                    <TableCell>{sale.customerName || <span className="text-muted-foreground italic">Walk-in</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(sale.date)}</TableCell>
                    <TableCell>{PAYMENT_METHODS.find(m => m.value === sale.paymentMethod)?.label || sale.paymentMethod}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{sale.remarks || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-500">{formatCurrency(sale.amount)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(sale.id)}>
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

      {/* Quick Sale Dialog */}
      <Dialog open={showAdd} onClose={() => { resetForm(); setShowAdd(false); }}>
        <div className="space-y-4 p-4" onKeyDown={handleKeyDown}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-amber-500" /> Quick Cash Sale</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Amount (PKR) *</Label>
                <Button 
                  type="button" 
                  variant={showCalc ? "default" : "outline"} 
                  size="sm" 
                  className="h-6 text-[10px] gap-1"
                  onClick={() => setShowCalc(!showCalc)}
                >
                  <Calculator className="h-3 w-3" />
                  {showCalc ? "Hide Calculator" : "Use Calculator"}
                </Button>
              </div>
              <Input ref={amountRef} type="number" step="1" min="1" placeholder="Enter amount" value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            {showCalc && (
              <PriceCalculator
                values={calcValues}
                onChange={(newVals) => {
                  setCalcValues(newVals);
                  // Auto-fill amount from calculator purchase price or sale price
                  const calcAmount = newVals.salePrice > 0 ? newVals.salePrice : newVals.purchasePrice;
                  if (calcAmount > 0) {
                    setForm(p => ({ ...p, amount: String(Math.round(calcAmount)) }));
                  }
                }}
                compact
                showSalePrice={true}
              />
            )}
            <div>
              <Label>Customer Name (optional)</Label>
              <Input placeholder="Walk-in customer name" value={form.customerName}
                onChange={e => setForm(p => ({ ...p, customerName: e.target.value }))} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={form.paymentMethod} onChange={v => setForm(p => ({ ...p, paymentMethod: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Remarks</Label>
              <Input placeholder="Optional remarks" value={form.remarks}
                onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowAdd(false); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? "Processing..." : "Record Sale"}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Cash Sale"
        description="This will permanently delete this cash sale record."
      />
    </div>
  );
}
