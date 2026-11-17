"use client";

import { useRouter } from "next/navigation";
import {
  Plus, ShoppingCart, DollarSign, Wallet, History, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AdvancedFilter } from "@/components/shared/advanced-filter";
import { formatCurrency, formatDate } from "@/lib/utils";
import { BillBadge, BilledPaid, Tile } from "@/components/shared/party-money";

export interface BillRow {
  id: string; docNo: string; type: string; revision: number; date: string; status: string;
  customer: string; walkIn: boolean; items: string;
  total: string; paid: string; remaining: string; paymentStatus: string; profit: string; madeBy: string;
}

interface Props {
  rows: BillRow[];
  stats: { count: number; total: string; outstanding: string; profit: string };
  pagination: { page: number; totalPages: number; totalRecords: number };
  customers: { id: string; name: string }[];
  olderCount: number;
  olderCashCount: number;
  canReceive: boolean;
}

export const BILL_STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" }> = {
  PAID: { label: "Paid", variant: "success" },
  PARTIALLY_PAID: { label: "Partially paid", variant: "warning" },
  UNPAID: { label: "Unpaid", variant: "secondary" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
};

const rs = (v: string) => formatCurrency(Number(v));

export default function BillsClient({ rows, stats, pagination, customers, olderCount, olderCashCount, canReceive }: Props) {
  const router = useRouter();
  const go = (page: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(page));
    router.push(`/dashboard/sales?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Bills, what each has received, and what is still owed"
        icon={ShoppingCart}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push("/dashboard/sales/receivables")}>
              <DollarSign className="h-4 w-4 mr-1" /> Outstanding
            </Button>
            {canReceive && (
              <Button variant="outline" onClick={() => router.push("/dashboard/sales/payments")}>
                <Wallet className="h-4 w-4 mr-1" /> Receive payment
              </Button>
            )}
            <Button onClick={() => router.push("/dashboard/sales/new")}>
              <Plus className="h-4 w-4 mr-1" /> New Sale
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile id="bills" label="Bills" value={String(stats.count)} sub={`sales ${rs(stats.total)}`} tone="blue" />
        <Tile id="owed" label="Still owed by customers" value={rs(stats.outstanding)} tone={Number(stats.outstanding) > 0 ? "red" : "green"} />
        <Tile id="profit" label="Profit (at cost)" value={rs(stats.profit)} tone="green" />
      </div>

      <AdvancedFilter
        moduleName="sales"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Bill number, customer, item..." },
          { key: "customerId", label: "Customer", type: "select", placeholder: "All customers", options: customers.map((c) => ({ label: c.name, value: c.id })) },
          { key: "status", label: "Status", type: "select", placeholder: "All", options: Object.entries(BILL_STATUS).map(([value, s]) => ({ label: s.label, value })) },
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No bills found" description="Try other filters, or make a new sale." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead><span className="text-sky-700 dark:text-sky-300">Billed</span> / <span className="text-emerald-700 dark:text-emerald-300">Received</span></TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/dashboard/sales/${r.id}`)}>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{r.docNo}</code>
                          {r.walkIn && <span className="ml-1 text-xs text-muted-foreground">walk-in</span>}
                        </TableCell>
                        <TableCell className="font-medium">{r.customer}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground text-xs">{r.items}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{rs(r.total)}</TableCell>
                        <TableCell>{r.status === "POSTED" ? <BilledPaid money={{ billed: r.total, paid: r.paid, balance: r.remaining }} format={formatCurrency} /> : <span className="text-muted-foreground">-</span>}</TableCell>
                        <TableCell><BillBadge status={r.paymentStatus} owed={r.remaining} side="customer" format={formatCurrency} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {olderCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/sales/older")}>
              <History className="h-4 w-4 mr-1" /> Older bills ({olderCount})
            </Button>
          )}
          {olderCashCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/cash-sales")}>
              <History className="h-4 w-4 mr-1" /> Older cash sales ({olderCashCount})
            </Button>
          )}
        </div>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} ({pagination.totalRecords} bills)</span>
            <Button variant="outline" size="sm" onClick={() => go(pagination.page - 1)} disabled={pagination.page <= 1}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => go(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
