"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, ShoppingCart, DollarSign, TrendingUp, FileText,
  Search, Eye, BadgeCheck, Clock, Ban, Banknote, Smartphone,
  User, Hash, ChevronLeft, ChevronRight
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
import { AdvancedFilter } from "@/components/shared/advanced-filter";

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
  pagination: { page: number; totalPages: number; totalRecords: number };
}

const statusConfig: Record<string, { icon: React.ElementType; variant: "success"|"warning"|"destructive"|"secondary"; label: string }> = {
  PAID: { icon: BadgeCheck, variant: "success", label: "Paid" },
  PARTIAL: { icon: Clock, variant: "warning", label: "Partial" },
  PENDING: { icon: Clock, variant: "secondary", label: "Pending" },
  OVERDUE: { icon: Ban, variant: "destructive", label: "Overdue" },
};

export default function SalesClient({ sales, customers, stats, pagination }: Props) {
  const router = useRouter();
  
  // Use debounced search to update URL
  const handleSearch = (term: string) => {
    const params = new URLSearchParams(window.location.search);
    if (term) params.set("search", term);
    else params.delete("search");
    params.set("page", "1"); // reset page
    router.push(`/dashboard/sales?${params.toString()}`);
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.set("page", "1"); // reset page
    router.push(`/dashboard/sales?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", newPage.toString());
    router.push(`/dashboard/sales?${params.toString()}`);
  };



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

      {/* Filter */}
      <AdvancedFilter
        moduleName="sales"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Search invoice, customer, items..." },
          { key: "customerId", label: "Customer", type: "select", placeholder: "All Customers", options: customers.map(c => ({ label: c.name, value: c.id })) },
          { key: "paymentStatus", label: "Status", type: "select", placeholder: "All Status", options: [
            { label: "Paid", value: "PAID" },
            { label: "Partial", value: "PARTIAL" },
            { label: "Pending", value: "PENDING" },
            { label: "Overdue", value: "OVERDUE" },
          ] },
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
          { key: "minAmount", label: "Min Amount", type: "number", placeholder: "Min" },
          { key: "maxAmount", label: "Max Amount", type: "number", placeholder: "Max" },
        ]}
        onSearchChange={handleSearch}
      />

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {sales.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No sales found"
              description="Try adjusting your filters or create a new sale."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((s) => {
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
        </CardContent>
      </Card>

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing page {pagination.page} of {pagination.totalPages} ({pagination.totalRecords} records)
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page <= 1}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm font-medium">Page {pagination.page}</span>
            <Button variant="outline" size="sm" onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}