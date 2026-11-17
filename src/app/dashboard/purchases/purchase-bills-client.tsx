"use client";

import { useRouter } from "next/navigation";
import { Plus, Truck, DollarSign, Wallet, History, ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AdvancedFilter } from "@/components/shared/advanced-filter";
import { formatDate, formatPaisa } from "@/lib/utils";
import { BillBadge, BilledPaid, Tile } from "@/components/shared/party-money";

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

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile id="bills" label="Bills" value={String(stats.count)} sub={`purchases ${rs(stats.total)}`} tone="blue" />
        <Tile id="payable" label="Still payable to suppliers" value={rs(stats.payable)} tone={Number(stats.payable) > 0 ? "red" : "green"} />
        <Tile id="overdue" label="Bills past their due date" value={String(stats.overdue)} tone={stats.overdue > 0 ? "amber" : "green"} />
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
                    <TableHead><span className="text-sky-700 dark:text-sky-300">Billed</span> / <span className="text-emerald-700 dark:text-emerald-300">Paid</span></TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/dashboard/purchases/${r.id}`)}>
                        <TableCell><a href={`/dashboard/purchases/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono hover:underline">{r.docNo}</a></TableCell>
                        <TableCell className="font-medium">{r.supplier}<div className="text-xs font-mono text-muted-foreground">{r.supplierCode}</div></TableCell>
                        <TableCell className="text-xs">{r.vendorBillNo ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{rs(r.total)}</TableCell>
                        <TableCell>{r.status === "POSTED" ? <BilledPaid money={{ billed: r.total, paid: r.paid, balance: r.remaining }} format={formatPaisa} /> : <span className="text-muted-foreground">-</span>}</TableCell>
                        <TableCell><BillBadge status={r.paymentStatus} owed={r.remaining} side="supplier" format={formatPaisa} overdue={r.overdue} /></TableCell>
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
