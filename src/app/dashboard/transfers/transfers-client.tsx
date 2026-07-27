"use client";

import { useState } from "react";
import { Plus, ArrowLeftRight, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";

interface TransferItem {
  id: string; fromAccountId: string; toAccountId: string; amount: number;
  transferType: string; voucherNumber: string | null; notes: string | null;
  date: string; createdAt: string;
  fromAccount: { id: string; name: string; type: string };
  toAccount: { id: string; name: string; type: string };
}

interface AccountOption {
  id: string; name: string; type: string; currentBalance: number;
}

interface Props {
  transfers: TransferItem[];
  accounts: AccountOption[];
}

const TRANSFER_TYPES = [
  { value: "CASH_TO_BANK", label: "Cash → Bank" },
  { value: "BANK_TO_CASH", label: "Bank → Cash" },
  { value: "CASH_TO_WALLET", label: "Cash → Wallet" },
  { value: "WALLET_TO_BANK", label: "Wallet → Bank" },
  { value: "INTERNAL", label: "Internal Transfer" },
];

export default function TransfersClient({ transfers: initialTransfers, accounts }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ fromAccountId: "", toAccountId: "", amount: "", transferType: "CASH_TO_BANK", voucherNumber: "", notes: "", date: new Date().toISOString().split("T")[0] });
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => setForm({ fromAccountId: "", toAccountId: "", amount: "", transferType: "CASH_TO_BANK", voucherNumber: "", notes: "", date: new Date().toISOString().split("T")[0] });

  const handleCreate = async () => {
    if (!form.fromAccountId || !form.toAccountId || !form.amount) { toast.error("All fields required"); return; }
    if (form.fromAccountId === form.toAccountId) { toast.error("Cannot transfer to same account"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount), date: new Date(form.date) }),
      });
      const data = await res.json();
      if (data.success) { toast.success("Transfer completed"); resetForm(); setShowAdd(false); window.location.reload(); }
      else toast.error(data.error);
    } catch { toast.error("Network error"); }
    setSubmitting(false);
  };

  const getTypeLabel = (val: string) => TRANSFER_TYPES.find(t => t.value === val)?.label || val;

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Account Transfers" description="Transfer funds between bank, cash, and digital wallets" icon={ArrowLeftRight}
        actions={<Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" /> New Transfer</Button>} />

      {/* Account Balances */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {accounts.map(a => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{a.name}</p>
                <p className={`text-lg font-bold ${a.currentBalance >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {formatCurrency(a.currentBalance)}
                </p>
                <Badge variant="secondary" className="text-xs">{a.type}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Transfers Table */}
      {initialTransfers.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers yet" description="Create your first account transfer" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead></TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialTransfers.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell className="font-medium">{t.fromAccount.name}</TableCell>
                    <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    <TableCell className="font-medium">{t.toAccount.name}</TableCell>
                    <TableCell><Badge variant="secondary">{getTypeLabel(t.transferType)}</Badge></TableCell>
                    <TableCell className="text-muted-foreground font-mono">{t.voucherNumber || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-blue-500">{formatCurrency(t.amount)}</TableCell>
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
          <DialogHeader><DialogTitle>New Account Transfer</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>From Account *</Label>
              <Select value={form.fromAccountId} onChange={v => setForm(p => ({ ...p, fromAccountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select source account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name} — {formatCurrency(a.currentBalance)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To Account *</Label>
              <Select value={form.toAccountId} onChange={v => setForm(p => ({ ...p, toAccountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select destination account" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.id !== form.fromAccountId).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name} — {formatCurrency(a.currentBalance)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (PKR) *</Label>
              <Input type="number" step="1" min="1" value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Transfer Type</Label>
              <Select value={form.transferType} onChange={v => setForm(p => ({ ...p, transferType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRANSFER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Voucher Number</Label>
              <Input placeholder="Optional voucher #" value={form.voucherNumber}
                onChange={e => setForm(p => ({ ...p, voucherNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowAdd(false); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting}>{submitting ? "Transferring..." : "Transfer"}</Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  );
}
