"use client";

import { useState, useMemo } from "react";
import { Plus, Wallet, Banknote, Smartphone, Building2, Trash2, Edit, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SearchInput } from "@/components/shared/search-input";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AdvancedFilter } from "@/components/shared/advanced-filter";

interface AccountItem {
  id: string; name: string; type: string; accountNumber: string | null;
  bankName: string | null; currentBalance: number; isActive: boolean;
  notes: string | null; createdAt: string;
}

interface Props {
  accounts: AccountItem[];
  summary: { totalBalance: number; bankBalance: number; cashBalance: number; walletBalance: number };
}

const ACCOUNT_TYPES = [
  { value: "BANK", label: "Bank Account", icon: Building2, color: "text-blue-500", bg: "bg-blue-500/10" },
  { value: "CASH", label: "Cash", icon: Banknote, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { value: "DIGITAL_WALLET", label: "Digital Wallet", icon: Smartphone, color: "text-violet-500", bg: "bg-violet-500/10" },
  { value: "EXPENSE", label: "Expense Account", icon: CreditCard, color: "text-red-500", bg: "bg-red-500/10" },
];

const emptyForm = { name: "", type: "BANK", accountNumber: "", bankName: "", currentBalance: "", notes: "" };

export default function AccountsClient({ accounts: initialAccounts, summary }: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AccountItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetForm = () => setForm(emptyForm);

  const handleSearch = (term: string) => {
    const params = new URLSearchParams(window.location.search);
    if (term) params.set("search", term);
    else params.delete("search");
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  const openEdit = (a: AccountItem) => {
    setEditing(a);
    setForm({ name: a.name, type: a.type, accountNumber: a.accountNumber || "", bankName: a.bankName || "", currentBalance: String(a.currentBalance), notes: a.notes || "" });
  };

  const handleSave = async () => {
    if (!form.name || !form.type) { toast.error("Name and type are required"); return; }
    setSubmitting(true);
    try {
      const url = editing ? `/api/accounts/${editing.id}` : "/api/accounts";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, currentBalance: parseFloat(form.currentBalance) || 0 }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editing ? "Account updated" : "Account created");
        resetForm(); setShowAdd(false); setEditing(null);
        window.location.reload();
      } else toast.error(data.error);
    } catch { toast.error("Network error"); }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await fetch(`/api/accounts/${deleteId}`, { method: "DELETE" });
      toast.success("Account deleted");
      setDeleteId(null);
      window.location.reload();
    } catch { toast.error("Failed to delete"); }
    setDeleting(false);
  };

  const getTypeInfo = (type: string) => ACCOUNT_TYPES.find(t => t.value === type) || ACCOUNT_TYPES[0];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Financial Accounts"
        description="Manage bank accounts, cash-in-hand, and digital wallets"
        icon={Wallet}
        actions={<Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" /> Add Account</Button>}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Balance", amount: summary.totalBalance, icon: Wallet, color: "emerald" },
          { label: "Bank Balance", amount: summary.bankBalance, icon: Building2, color: "blue" },
          { label: "Cash in Hand", amount: summary.cashBalance, icon: Banknote, color: "amber" },
          { label: "Digital Wallets", amount: summary.walletBalance, icon: Smartphone, color: "violet" },
        ].map((stat, i) => (
          <Card key={i} className={`bg-gradient-to-br from-${stat.color}-500/10 to-${stat.color}-600/5 border-${stat.color}-500/20`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-${stat.color}-500/20`}>
                  <stat.icon className={`h-5 w-5 text-${stat.color}-500`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={`text-xl font-bold text-${stat.color}-500`}>{formatCurrency(stat.amount)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <AdvancedFilter
        moduleName="accounts"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Search accounts by name, bank, or number..." },
          { key: "type", label: "Type", type: "select", placeholder: "All Types", options: [
            { label: "Bank Accounts", value: "BANK" },
            { label: "Cash", value: "CASH" },
            { label: "Digital Wallet", value: "DIGITAL_WALLET" },
            { label: "Expense Account", value: "EXPENSE" }
          ] },
        ]}
        onSearchChange={handleSearch}
      />

      {/* Account Cards */}
      {initialAccounts.length === 0 ? (
        <EmptyState icon={Wallet} title="No accounts found" description="Try adjusting your filters or add an account" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {initialAccounts.map(account => {
            const typeInfo = getTypeInfo(account.type);
            const TypeIcon = typeInfo.icon;
            return (
              <Card key={account.id} className="relative overflow-hidden hover:shadow-lg transition-shadow">
                <div className={`absolute top-0 left-0 right-0 h-1 ${account.currentBalance >= 0 ? "bg-emerald-500" : "bg-red-500"}`} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${typeInfo.bg}`}>
                        <TypeIcon className={`h-5 w-5 ${typeInfo.color}`} />
                      </div>
                      <div>
                        <CardTitle className="text-base">{account.name}</CardTitle>
                        <Badge variant="secondary" className="text-xs">{typeInfo.label}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(account)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(account.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className={`text-2xl font-bold ${account.currentBalance >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {formatCurrency(account.currentBalance)}
                  </p>
                  {account.bankName && <p className="text-sm text-muted-foreground mt-1">{account.bankName}</p>}
                  {account.accountNumber && <p className="text-xs text-muted-foreground font-mono">{account.accountNumber}</p>}
                  {account.notes && <p className="text-xs text-muted-foreground mt-2">{account.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showAdd || !!editing} onClose={() => { resetForm(); setShowAdd(false); setEditing(null); }}>
        <div className="space-y-4 p-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Account" : "Add New Account"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Account Name *</Label>
              <Input placeholder="e.g., HBL Main, Shop Cash" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label>Account Type *</Label>
              <Select value={form.type} onChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(form.type === "BANK" || form.type === "DIGITAL_WALLET") && (
              <>
                <div>
                  <Label>Bank Name</Label>
                  <Input placeholder="e.g., HBL, Meezan Bank" value={form.bankName}
                    onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
                </div>
                <div>
                  <Label>Account Number</Label>
                  <Input placeholder="Account number" value={form.accountNumber}
                    onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <Label>Current Balance (PKR)</Label>
              <Input type="number" step="1" placeholder="0" value={form.currentBalance}
                onChange={e => setForm(p => ({ ...p, currentBalance: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowAdd(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={submitting}>{submitting ? "Saving..." : "Save Account"}</Button>
          </DialogFooter>
        </div>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Delete Account" description="This will permanently delete this account." />
    </div>
  );
}
