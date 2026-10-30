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

      <div className="grid gap-4 sm:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total owed</p><p className="text-xl font-bold tabular-nums">{rs(r.total)}</p></CardContent></Card>
        {r.buckets.map((b) => (
          <Card key={b}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{AGE_LABEL[b]}</p><p className="text-xl font-bold tabular-nums">{rs(r.ageTotals[b])}</p></CardContent></Card>
        ))}
      </div>

      {r.customers.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No customer owes anything.</CardContent></Card>
      ) : r.customers.map((c) => (
        <Card key={c.partyAccountId} className="break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{c.name}{c.phone ? <span className="ml-2 text-sm font-normal text-muted-foreground">{c.phone}</span> : null}</span>
              <span className="tabular-nums">{rs(c.outstanding)}{Number(c.credit) > 0 && <span className="ml-2 text-sm font-normal text-emerald-600">credit {rs(c.credit)}</span>}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Age</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Remaining</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><Link className="font-mono text-xs underline-offset-2 hover:underline" href={`/dashboard/sales/${i.id}`}>{i.docNo}</Link></TableCell>
                    <TableCell className="text-xs">{formatDate(i.date)}</TableCell>
                    <TableCell className="text-right text-xs">{i.days} days</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(i.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(i.paid)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{rs(i.remaining)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap gap-3 border-t p-3 text-sm print:hidden">
              {canReceive && c.customerId && <Link className="underline" href={`/dashboard/sales/payments?customerId=${c.customerId}`}>Receive payment</Link>}
              {c.customerId && <Link className="underline" href={`/dashboard/customers/${c.customerId}/statement`}>Statement</Link>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
