// src/app/dashboard/purchases/payables/page.tsx - Outstanding payables (Report 30 §7): what is still owed to each supplier,
// bill by bill, by age and due date, with any supplier credit.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingReady } from "@/lib/accounting/server";
import { payablesReport } from "@/lib/purchases/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatPaisa } from "@/lib/utils";
import { BillBadge, BilledPaid, Tile, type Tone } from "@/components/shared/party-money";

const AGE_TONE: Record<string, Tone> = { "0-30": "blue", "31-60": "amber", "61-90": "amber", "90+": "red" };

export const dynamic = "force-dynamic";

export default async function PayablesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "supplierPayments", "read")) redirect("/dashboard/purchases");
  await accountingReady();
  const r = await payablesReport(prisma);
  const canPay = can(user.role, "supplierPayments", "write");
  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/purchases" aria-label="Back to Purchases" className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-accent"><ArrowLeft className="h-5 w-5" aria-hidden /></Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payables</h1>
          <p className="text-sm text-muted-foreground">Unpaid and part-paid purchase bills by supplier, as on {formatDate(r.asOf)}</p>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <div className="col-span-2"><Tile id="payable" label="Total payable" value={formatPaisa(r.total)} sub={`past due date: ${formatPaisa(r.overdue)}`} tone={Number(r.total) > 0 ? "red" : "green"} big /></div>
        {r.buckets.map((b) => <Tile key={b} id={b} label={`${b} days old`} value={formatPaisa(r.ageTotals[b])} tone={Number(r.ageTotals[b]) > 0 ? AGE_TONE[b] : "green"} />)}
      </div>

      {r.suppliers.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is owed to any supplier.</p> : r.suppliers.map((s) => (
        <Card key={s.partyAccountId}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{s.supplierId ? <Link className="hover:underline" href={`/dashboard/suppliers/${s.supplierId}`}>{s.name}</Link> : s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span></span>
              <span className="flex flex-wrap items-center gap-2 text-sm font-normal">
                <BillBadge status="UNPAID" owed={s.outstanding} side="supplier" format={formatPaisa} />
                {Number(s.overdue) > 0 && <Badge variant="destructive">{formatPaisa(s.overdue)} overdue</Badge>}
                {Number(s.credit) > 0 && <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">Advance {formatPaisa(s.credit)}</span>}
                {canPay && s.supplierId && <Link className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700" href={`/dashboard/purchases/pay?supplierId=${s.supplierId}`}>Pay supplier</Link>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Supplier bill</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Days</TableHead><TableHead className="text-right">Total</TableHead><TableHead><span className="text-sky-700 dark:text-sky-300">Billed</span> / <span className="text-emerald-700 dark:text-emerald-300">Paid</span></TableHead><TableHead className="text-right">Payable</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Link className="font-mono text-xs hover:underline" href={`/dashboard/purchases/${b.id}`}>{b.docNo}</Link></TableCell>
                    <TableCell className="text-xs">{b.vendorBillNo ?? "-"}</TableCell>
                    <TableCell className="text-xs">{formatDate(b.date)}</TableCell>
                    <TableCell className={`text-xs ${b.overdue ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{b.dueDate ? `${formatDate(b.dueDate)}${b.overdue ? " (overdue)" : ""}` : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.days}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(b.total)}</TableCell>
                    <TableCell><BilledPaid money={{ billed: b.total, paid: b.paid, balance: b.remaining }} format={formatPaisa} /></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-rose-700 dark:text-rose-300">{formatPaisa(b.remaining)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
