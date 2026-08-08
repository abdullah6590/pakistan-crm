"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, Truck, DollarSign, Receipt, FileText,
  Search, Eye, BadgeCheck, Clock, Ban, Hash,
  TrendingDown, Wallet, ChevronLeft, ChevronRight
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
import { AdvancedFilter } from "@/components/shared/advanced-filter";

interface PurchaseItem {
  id: string; poNumber: string;
  supplier: { id: string; name: string; phone: string };
  invoiceRef: string | null;
  subtotal: number; tax: number; shipping: number; total: number;
  paidAmount: number; paymentStatus: string;
  createdAt: string;
  items: { id: string; component: { id: string; name: string; sku: string }; quantity: number; unitCost: number; totalCost: number }[];
}

interface SupplierOption { id: string; name: string; }

interface Props {
  purchases: PurchaseItem[];
  suppliers: SupplierOption[];
  stats: { totalSpent: number; totalPaid: number; totalPending: number; totalPurchases: number };
  pagination: { page: number; totalPages: number; totalRecords: number };
}

const statusConfig: Record<string, { icon: React.ElementType; variant: "success"|"warning"|"destructive"|"secondary"; label: string }> = {
  PAID: { icon: BadgeCheck, variant: "success", label: "Paid" },
  PARTIAL: { icon: Clock, variant: "warning", label: "Partial" },
  PENDING: { icon: Clock, variant: "secondary", label: "Pending" },
  OVERDUE: { icon: Ban, variant: "destructive", label: "Overdue" },
};

export default function PurchasesClient({ purchases, suppliers, stats, pagination }: Props) {
  const router = useRouter();
  
  // Use debounced search to update URL
  const handleSearch = (term: string) => {
    const params = new URLSearchParams(window.location.search);
    if (term) params.set("search", term);
    else params.delete("search");
    params.set("page", "1");
    router.push(`/dashboard/purchases?${params.toString()}`);
  };

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`/dashboard/purchases?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", newPage.toString());
    router.push(`/dashboard/purchases?${params.toString()}`);
  };



  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="Manage component purchases from suppliers"
        icon={Truck}
        actions={
          <Button onClick={() => router.push("/dashboard/purchases/new")}>
            <Plus className="h-4 w-4 mr-1" /> New Purchase
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600"><Receipt className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Orders</p>
              <p className="text-xl font-bold">{stats.totalPurchases}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-red-100 dark:bg-red-900/30 text-red-600"><TrendingDown className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Spent</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalSpent)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><BadgeCheck className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Paid</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalPaid)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600"><Wallet className="h-4 w-4" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Pending Payments</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalPending)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      {/* Filters */}
      <AdvancedFilter
        moduleName="purchases"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Search PO number or supplier..." },
          { key: "supplierId", label: "Supplier", type: "select", placeholder: "All Suppliers", options: suppliers.map(s => ({ label: s.name, value: s.id })) },
          { key: "paymentStatus", label: "Status", type: "select", placeholder: "All Status", options: [
            { label: "Paid", value: "PAID" },
            { label: "Partial", value: "PARTIAL" },
            { label: "Pending", value: "PENDING" },
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
          {purchases.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No purchases found"
              description="Try adjusting your filters or create a new purchase order."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p) => {
                    const status = statusConfig[p.paymentStatus] || statusConfig.PENDING;
                    const StatusIcon = status.icon;
                    return (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/dashboard/purchases/${p.id}`)}
                      >
                        <TableCell className="font-medium font-mono text-sm">{p.poNumber}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{p.supplier.name}</p>
                          {p.invoiceRef && <p className="text-xs text-muted-foreground">Ref: {p.invoiceRef}</p>}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{p.items.length} item{p.items.length !== 1 ? "s" : ""}</span>
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">{formatCurrency(p.total)}</TableCell>
                        <TableCell className="tabular-nums text-sm text-emerald-600">{formatCurrency(p.paidAmount)}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" /> {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{timeAgo(p.createdAt)}</TableCell>
                        <TableCell>
                          <Link href={`/dashboard/purchases/${p.id}`} onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
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