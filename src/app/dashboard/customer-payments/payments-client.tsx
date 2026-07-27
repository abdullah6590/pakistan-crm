"use client";

import { useState, useMemo } from "react";
import { Plus, Banknote, Search, Trash2, ArrowDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";

interface CustomerPaymentItem {
  id: string; amount: number; paymentMethod: string; chequeNumber: string | null;
  bankName: string | null; date: string; notes: string | null;
  customer: { id: string; name: string; phone: string | null };
}

interface CustomerOption {
  id: string; name: string; phone: string | null; balanceDue: number;
}

interface Props {
  payments: CustomerPaymentItem[];
  customers: CustomerOption[];
  totalReceived: number;
}

export default function CustomerPaymentsClient({ payments: initialData, customers, totalReceived }: Props) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ customerId: "", amount: "", paymentMethod: "CASH", chequeNumber: "", bankName: "", notes: "", date: new Date().toISOString().split("T")[0] });
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return initialData;
    const q = search.toLowerCase();
    return initialData.filter(p => p.customer.name.toLowerCase().includes(q) || (p.customer.phone && p.customer.phone.toLowerCase().includes(q)));
  }, [initialData, search]);

  const resetForm = () => setForm({ customerId: "", amount: "", paymentMethod: "CASH", chequeNumber: "", bankName: "", notes: "", date: new Date().toISOString().split("T")[0] });

  const handleCreate = async () => {
    if (!form.customerId || !form.amount) { toast.error("Customer and amount are required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/customer-payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount), date: new Date(form.date) }),
      });
      const data = await res.json();
      if (data.success) { toast.success("Payment received"); resetForm(); setShowAdd(false); window.location.reload(); }
      else toast.error(data.error);
    } catch { toast.error("Network error"); }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { await fetch(`/api/customer-payments/${deleteId}`, { method: "DELETE" }); toast.success("Deleted"); setDeleteId(null); window.location.reload(); }
    catch { toast.error("Failed"); }
    setDeleting(false);
  };

  const getMethodLabel = (val: string) => PAYMENT_METHODS.find(m => m.value === val)?.label || val;
  const selectedCustomer = customers.find(c => c.id === form.customerId);

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Customer Receipts" description="Record payments received from customers" icon={ArrowDownLeft}
        actions={<Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" /> Record Receipt</Button>} />

      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-64">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by customer name..." />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ArrowDownLeft} title="No receipts" description="Record a payment received from a customer" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                    <TableCell>
                      <Link href={`/dashboard/customers/${p.customer.id}/ledger`} className="font-medium hover:underline text-blue-600">
                        {p.customer.name}
                      </Link>
                      {p.customer.phone && <div className="text-xs text-muted-foreground">{p.customer.phone}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getMethodLabel(p.paymentMethod)}</Badge>
                      {p.chequeNumber && <span className="ml-2 text-xs text-muted-foreground font-mono">#{p.chequeNumber}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.notes || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-500">{formatCurrency(p.amount)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)}>
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

      <Dialog open={showAdd} onClose={() => { resetForm(); setShowAdd(false); }}>
        <div className="space-y-4 p-4">
          <DialogHeader><DialogTitle>Record Customer Receipt</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Customer *</Label>
              <Select value={form.customerId} onChange={v => setForm(p => ({ ...p, customerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedCustomer && (
                <p className="text-xs text-muted-foreground mt-1">
                  Receivable Balance: <span className="font-semibold text-emerald-500">{formatCurrency(selectedCustomer.balanceDue)}</span>
                </p>
              )}
            </div>
            <div>
              <Label>Amount (PKR) *</Label>
              <Input type="number" step="1" min="1" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Payment Method *</Label>
              <Select value={form.paymentMethod} onChange={v => setForm(p => ({ ...p, paymentMethod: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {["CHEQUE", "BANK_TRANSFER"].includes(form.paymentMethod) && (
              <>
                <div>
                  <Label>Bank Name</Label>
                  <Input value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
                </div>
                <div>
                  <Label>Cheque / Ref Number</Label>
                  <Input value={form.chequeNumber} onChange={e => setForm(p => ({ ...p, chequeNumber: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowAdd(false); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Processing..." : "Record Receipt"}</Button>
          </DialogFooter>
        </div>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Delete Receipt" description="Deleting this receipt will revert the customer balance." />
    </div>
  );
}
