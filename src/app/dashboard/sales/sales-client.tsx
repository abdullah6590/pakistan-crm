"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, ShoppingCart, DollarSign, TrendingUp, FileText,
  Search, Eye, BadgeCheck, Clock, Ban, Banknote, Smartphone,
  User, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatDate, timeAgo } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/constants";

interface SaleItem {
  id: string; invoiceNumber: string; customer: { id: string; name: string; phone: string } | null;
  walkInName: string | null; subtotal: number; discount: number; tax: number; total: number;
  profit: number; paymentMethod: string; paymentStatus: string; createdAt: string;
  user: { name: string };
  items: { id: string; component: { id: string; name: string; sku: string }; quantity: number; unitPrice: number; totalPrice: number }[];
}

interface CustomerOption { id: string; name: string; }

interface Props {
  sales: SaleItem[];
  customers: CustomerOption[];
  stats: { totalRevenue: number; totalProfit: number; totalSales: number };
}

const statusConfig: Record<string, { icon: React.ElementType; variant: "success"|"warning"|"destructive"|"secondary"; label: string }> = {
  PAID: { icon: BadgeCheck, variant: "success", label: "Paid" },
  PARTIAL: { icon: Clock, variant: "warning", label: "Partial" },
  PENDING: { icon: Clock, variant: "secondary", label: "Pending" },
  OVERDUE: { icon: Ban, variant: "destructive", label: "Overdue" },
};

export default function SalesClient({ sales: initialSales, customers, stats }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = initialSales;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.invoiceNumber.toLowerCase().includes(q) ||
        s.customer?.name.toLowerCase().includes(q) ||
        s.walkInName?.toLowerCase().includes(q)
      );
    }
    if (customerFilter !== "all") list = list.filter(s => s.customer?.id === customerFilter);
    if (statusFilter !== "all") list = list.filter(s => s.paymentStatus === statusFilter);
    return list;
  }, [initialSales, search, customerFilter, statusFilter]);

  const paymentIcon: Record<string, React.ElementType> = {
    CASH: Banknote, JAZZCASH: Smartphone, EASYPAISA: Smartphone, BANK_TRANSFER: DollarSign,
    NAYAPAY: Smartphone, SADAPAY: Smartphone,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="View all component sales, invoices, and payment records"
        icon={ShoppingCart}
        actions={
          <Button onClick={() => router.push("/dashboard/sales/new")}>
            <Plus className="h-4 w-4 mr-1" /> New Sale
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10"><FileText className="h-5 w-5 text-blue-500" /></div>
          <div><p className="text-xs text-muted-foreground">Total Sales</p><p className="text-xl font-bold">{stats.totalSales}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10"><DollarSign className="h-5 w-5 text-emerald-500" /></div>
          <div><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-xl font-bold">{formatCurrency(stats.totalRevenue)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10"><TrendingUp className="h-5 w-5 text-violet-500" /></div>
          <div><p className="text-xs text-muted-foreground">Total Profit</p><p className="text-xl font-bold">{formatCurrency(stats.totalProfit)}</p></div>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <Card><CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoice or customer..." className="flex-1" />
          <Select value={customerFilter} onChange={setCustomerFilter}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="All Customers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="PARTIAL">Partial</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent></Card>

      {/* Table */}
      <Card><CardContent className="p-0">
        {filtered.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No sales found" description={search ? "Try adjusting your filters" : "Record your first sale"} action={!search ? { label: "New Sale", onClick: () => router.push("/dashboard/sales/new") } : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(s => {
                  const sConfig = statusConfig[s.paymentStatus] || statusConfig.PENDING;
                  const PI = paymentIcon[s.paymentMethod] || Banknote;
                  return (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/dashboard/sales/${s.id}`)}>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{s.invoiceNumber}</code></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{s.customer?.name || s.walkInName || "Walk-in"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{s.items.length} item{s.items.length !== 1 ? "s" : ""}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold">{formatCurrency(s.total)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm ${s.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(s.profit)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <PI className="h-3.5 w-3.5 text-muted-foreground" />
                          {PAYMENT_METHODS.find(m => m.value === s.paymentMethod)?.label || s.paymentMethod}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={sConfig.variant} size="sm">{sConfig.label}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{timeAgo(s.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}