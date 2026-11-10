"use client";
// src/app/dashboard/cash-sales/cash-sales-client.tsx - Older cash sales (read-only list). These records sit outside Books:
// they never moved stock and are not in the ledgers, daybook or Profit & Loss. They are kept so nothing is lost.

import { useMemo, useState } from "react";
import Link from "next/link";
import { History, Info, Plus, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface CashSaleItem {
  id: string; receiptNo: string; customerName: string | null;
  date: string; amount: number; remarks: string | null;
  paymentMethod: string; createdAt: string;
}

interface Props {
  sales: CashSaleItem[];
  allStats: { total: number; count: number };
  canSell: boolean;
}

export default function CashSalesClient({ sales, allStats, canSell }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return sales;
    const q = search.toLowerCase();
    return sales.filter((s) =>
      (s.customerName && s.customerName.toLowerCase().includes(q)) ||
      s.receiptNo.toLowerCase().includes(q) ||
      (s.remarks && s.remarks.toLowerCase().includes(q))
    );
  }, [sales, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Older cash sales"
        description="Cash sales saved on the old Cash Sales screen. They can be viewed but not changed."
        icon={History}
        actions={canSell ? (
          <Link
            href="/dashboard/sales/new?walkin=1"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden /> New cash sale
          </Link>
        ) : undefined}
      />

      <div role="note" className="flex gap-3 rounded-lg border bg-muted/50 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p>
          New cash sales are entered on <strong>New sale</strong> with the walk-in customer, so they take the items out of stock
          and show in the ledgers, the daybook and Profit &amp; Loss. The sales below were saved outside Books and are kept
          as they were.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Receipt className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-xs text-muted-foreground">Receipts</p><p className="text-xl font-bold">{allStats.count}</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Receipt className="h-5 w-5" aria-hidden /></div>
          <div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{formatCurrency(allStats.total)}</p></div>
        </CardContent></Card>
      </div>

      {sales.length > 0 && <SearchInput value={search} onChange={setSearch} placeholder="Search by name, receipt # or remarks..." />}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={sales.length ? "No cash sale matches" : "No older cash sales"}
          description={sales.length ? "Try other words." : "Nothing was saved on the old Cash Sales screen."}
        />
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-mono font-medium">{sale.receiptNo}</TableCell>
                    <TableCell>{sale.customerName || <span className="italic text-muted-foreground">Walk-in</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(sale.date)}</TableCell>
                    <TableCell>{PAYMENT_METHODS.find((m) => m.value === sale.paymentMethod)?.label || sale.paymentMethod}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{sale.remarks || "-"}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(sale.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
