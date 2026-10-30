// src/app/dashboard/purchases/payments/page.tsx - Supplier payment history (Report 30 §7): every payment and refund
// received from a supplier, the bills each settled, and its voucher PDF.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady } from "@/lib/accounting/server";
import { supplierPayments } from "@/lib/purchases/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatPaisa } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; cancelled?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "supplierPayments", "read")) redirect("/dashboard/purchases");
  await accountingReady();
  const p = await searchParams;
  const rows = await supplierPayments(prisma, { from: p.from, to: p.to, includeCancelled: p.cancelled === "1" });
  const total = rows.filter((r) => r.status === "POSTED" && r.kind === "PAYMENT").reduce((t, r) => t + Number(r.amount), 0);
  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/purchases" aria-label="Back to Purchases" className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-accent"><ArrowLeft className="h-5 w-5" aria-hidden /></Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Supplier payments</h1>
            <p className="text-sm text-muted-foreground">{rows.length} shown · paid {formatPaisa(total)}</p>
          </div>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className="space-y-1"><span className="block text-xs">From</span><input className="h-9 rounded-md border border-input bg-background px-2" type="date" name="from" defaultValue={p.from} /></label>
          <label className="space-y-1"><span className="block text-xs">To</span><input className="h-9 rounded-md border border-input bg-background px-2" type="date" name="to" defaultValue={p.to} /></label>
          <label className="flex items-center gap-1 pb-2"><input type="checkbox" name="cancelled" value="1" defaultChecked={p.cancelled === "1"} /> include cancelled</label>
          <button className="h-9 rounded-md border px-3 hover:bg-accent" type="submit">Show</button>
        </form>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No supplier payments in this period.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Voucher</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Account</TableHead><TableHead>Reference</TableHead><TableHead>Settled</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={r.status === "CANCELLED" ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{r.docNo}{r.status === "CANCELLED" && <Badge variant="destructive" className="ml-1">cancelled</Badge>}{r.kind === "REFUND_RECEIVED" && <Badge variant="secondary" className="ml-1">refund in</Badge>}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell>{r.supplierId ? <Link className="hover:underline" href={`/dashboard/suppliers/${r.supplierId}`}>{r.supplier}</Link> : r.supplier}</TableCell>
                      <TableCell className="text-xs">{r.account}</TableCell>
                      <TableCell className="text-xs">{r.reference ?? ""}</TableCell>
                      <TableCell className="text-xs">{r.bills.map((b) => `${b.docNo} ${formatPaisa(b.amount)}`).join(", ")}{Number(r.unapplied) > 0 ? `${r.bills.length ? ", " : ""}advance ${formatPaisa(r.unapplied)}` : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(r.amount)}</TableCell>
                      <TableCell><a className="text-xs text-primary hover:underline" href={`/api/purchases/payments/${r.id}/pdf?inline=1`} target="_blank" rel="noreferrer">PDF</a></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">A payment is cancelled in Books → Documents → Vouchers (administrators); the bills it settled become payable again.</p>
    </div>
  );
}
