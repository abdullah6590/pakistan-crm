// src/app/dashboard/sales/receivables/page.tsx - Outstanding receivables (Report 28 §2): what each customer still owes,
// bill by bill, with its age; and any unapplied credit they have.
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { receivablesReport } from "@/lib/sales/books-queries";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PrintButton from "@/app/dashboard/accounting/print-button";
import { BillBadge, BilledPaid, Tile, type Tone } from "@/components/shared/party-money";

const AGE_TONE: Record<string, Tone> = { "0-30": "blue", "31-60": "amber", "61-90": "amber", "90+": "red" };

export const dynamic = "force-dynamic";

const rs = (v: string) => formatCurrency(Number(v));
const AGE_LABEL: Record<string, string> = { "0-30": "0-30 days", "31-60": "31-60 days", "61-90": "61-90 days", "90+": "Over 90 days" };

export default async function ReceivablesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "customers", "read")) redirect("/dashboard");
  const r = await receivablesReport(prisma);
  const canReceive = can(user.role, "customerPayments", "write");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Outstanding receivables</h1>
          <p className="text-sm text-muted-foreground">What customers still owe, bill by bill, as of {formatDate(r.asOf)}</p>
        </div>
        <PrintButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <Tile id="owed" label="Total owed" value={rs(r.total)} tone={Number(r.total) > 0 ? "red" : "green"} big />
        {r.buckets.map((b) => <Tile key={b} id={b} label={AGE_LABEL[b]} value={rs(r.ageTotals[b])} tone={Number(r.ageTotals[b]) > 0 ? AGE_TONE[b] : "green"} />)}
      </div>

      {r.customers.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No customer owes anything.</CardContent></Card>
      ) : r.customers.map((c) => (
        <Card key={c.partyAccountId} className="break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{c.name}{c.phone ? <span className="ml-2 text-sm font-normal text-muted-foreground">{c.phone}</span> : null}</span>
              <span className="flex flex-wrap items-center gap-2"><BillBadge status="UNPAID" owed={c.outstanding} side="customer" format={formatCurrency} />{Number(c.credit) > 0 && <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">Advance {rs(c.credit)}</span>}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Age</TableHead><TableHead className="text-right">Total</TableHead><TableHead><span className="text-sky-700 dark:text-sky-300">Billed</span> / <span className="text-emerald-700 dark:text-emerald-300">Received</span></TableHead><TableHead className="text-right">Remaining</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><Link className="font-mono text-xs underline-offset-2 hover:underline" href={`/dashboard/sales/${i.id}`}>{i.docNo}</Link></TableCell>
                    <TableCell className="text-xs">{formatDate(i.date)}</TableCell>
                    <TableCell className="text-right text-xs">{i.days} days</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(i.total)}</TableCell>
                    <TableCell><BilledPaid money={{ billed: i.total, paid: i.paid, balance: i.remaining }} format={formatCurrency} /></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-rose-700 dark:text-rose-300">{rs(i.remaining)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap gap-3 border-t p-3 text-sm print:hidden">
              {canReceive && c.customerId && <Link className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700" href={`/dashboard/sales/payments?customerId=${c.customerId}`}>Receive payment</Link>}
              {c.customerId && <Link className="underline" href={`/dashboard/customers/${c.customerId}/statement`}>Statement</Link>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
