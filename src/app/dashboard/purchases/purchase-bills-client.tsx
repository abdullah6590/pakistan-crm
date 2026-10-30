"use client";

import { useRouter } from "next/navigation";
import { Plus, Truck, DollarSign, FileText, Wallet, History, ChevronLeft, ChevronRight, AlarmClock, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AdvancedFilter } from "@/components/shared/advanced-filter";
import { formatDate, formatPaisa } from "@/lib/utils";

export interface PurchaseRow {
  id: string; docNo: string; revision: number; date: string; status: string;
  supplier: string; supplierId: string | null; supplierCode: string; vendorBillNo: string | null; dueDate: string | null; overdue: boolean; items: string;
  total: string; paid: string; remaining: string; paymentStatus: string; madeBy: string;
}

export const PURCHASE_STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" }> = {
  PAID: { label: "Paid", variant: "success" },
  PARTIALLY_PAID: { label: "Partially paid", variant: "warning" },
  UNPAID: { label: "Unpaid", variant: "secondary" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  REPLACED: { label: "Replaced", variant: "secondary" },
};

const rs = (v: string) => formatPaisa(v);

export default function PurchaseBillsClient({ rows, stats, pagination, suppliers, olderCount, canCreate, canPay, canSeePayments }: {
  rows: PurchaseRow[];
  stats: { count: number; total: string; payable: string; overdue: number };
  pagination: { page: number; totalPages: number; totalRecords: number };
  suppliers: { id: string; name: string }[];
  olderCount: number;
  canCreate: boolean;
  canPay: boolean;
  canSeePayments: boolean;
}) {
  const router = useRouter();
  const go = (page: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(page));
    router.push(`/dashboard/purchases?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="Purchase bills, what has been paid, and what is still payable to suppliers"
        icon={Truck}
        actions={
          <div className="flex flex-wrap gap-2">
            {canSeePayments && (
              <>
                <Button variant="outline" onClick={() => router.push("/dashboard/purchases/payables")}><DollarSign className="h-4 w-4 mr-1" aria-hidden /> Payables</Button>
                <Button variant="outline" onClick={() => router.push("/dashboard/purchases/payments")}><Receipt className="h-4 w-4 mr-1" aria-hidden /> Payments</Button>
              </>
            )}
            {canPay && <Button variant="outline" onClick={() => router.push("/dashboard/purchases/pay")}><Wallet className="h-4 w-4 mr-1" aria-hidden /> Pay supplier</Button>}
            {canCreate && <Button onClick={() => router.push("/dashboard/purchases/new")}><Plus className="h-4 w-4 mr-1" aria-hidden /> New purchase</Button>}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10"><FileText className="h-5 w-5 text-blue-500" aria-hidden /></div>
          <div><p className="text-xs text-muted-foreground">Bills (purchases {rs(stats.total)})</p><p className="text-xl font-bold">{stats.count}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10"><DollarSign className="h-5 w-5 text-amber-500" aria-hidden /></div>
          <div><p className="text-xs text-muted-foreground">Still payable to suppliers</p><p className="text-xl font-bold">{rs(stats.payable)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10"><AlarmClock className="h-5 w-5 text-red-500" aria-hidden /></div>
          <div><p className="text-xs text-muted-foreground">Bills past their due date</p><p className="text-xl font-bold">{stats.overdue}</p></div>
        </CardContent></Card>
      </div>

      <AdvancedFilter
        moduleName="purchases"
        filters={[
          { key: "search", label: "Search", type: "search", placeholder: "Bill number, supplier bill no., supplier, item..." },
          { key: "supplierId", label: "Supplier", type: "select", placeholder: "All suppliers", options: suppliers.map((s) => ({ label: s.name, value: s.id })) },
          { key: "status", label: "Status", type: "select", placeholder: "All", options: [...["UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED"].map((v) => ({ label: PURCHASE_STATUS[v].label, value: v })), { label: "Overdue", value: "OVERDUE" }] },
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState icon={Truck} title="No purchase bills found" description="Try other filters, or enter a new purchase." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Supplier bill</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Still payable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const st = PURCHASE_STATUS[r.paymentStatus] ?? PURCHASE_STATUS.UNPAID;
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/dashboard/purchases/${r.id}`)}>
                        <TableCell><a href={`/dashboard/purchases/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono hover:underline">{r.docNo}</a></TableCell>
                        <TableCell className="font-medium">{r.supplier}<div className="text-xs font-mono text-muted-foreground">{r.supplierCode}</div></TableCell>
                        <TableCell className="text-xs">{r.vendorBillNo ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{rs(r.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rs(r.paid)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{rs(r.remaining)}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {r.dueDate ? <span className={r.overdue ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground"}>{formatDate(r.dueDate)}{r.overdue ? " (overdue)" : ""}</span> : <span className="text-muted-foreground">-</span>}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        {olderCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/purchases/older")}><History className="h-4 w-4 mr-1" aria-hidden /> Older purchases ({olderCount})</Button>
        ) : <span />}
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} ({pagination.totalRecords} bills)</span>
            <Button variant="outline" size="sm" onClick={() => go(pagination.page - 1)} disabled={pagination.page <= 1}><ChevronLeft className="h-4 w-4 mr-1" aria-hidden /> Previous</Button>
            <Button variant="outline" size="sm" onClick={() => go(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next <ChevronRight className="h-4 w-4 ml-1" aria-hidden /></Button>
          </div>
        )}
      </div>
    </div>
  );
}
