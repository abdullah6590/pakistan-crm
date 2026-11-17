// src/app/dashboard/sales/cash-report/page.tsx - Cash Report (old Cash Sale → Cash Report, Report 33): cash sales between
// dates, still owing, unpaid between dates, all, and the day book with each bill's lines. Each bill opens on the desk,
// where Cash Update takes the rest of the money.
import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CASH_REPORT_MODES, type CashReportMode, cashDayBook, cashReport } from "@/lib/sales/cash-report";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PrintButton from "@/app/dashboard/accounting/print-button";

export const dynamic = "force-dynamic";

const LABEL: Record<CashReportMode | "daybook", string> = {
  dates: "Between dates", owing: "Still owing", unpaid: "Unpaid between dates", all: "All cash sales", daybook: "Day book",
};
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

export default async function CashReportPage({ searchParams }: { searchParams: Promise<{ mode?: string; from?: string; to?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "sales", "read")) redirect("/dashboard");
  const sp = await searchParams;
  const mode = (sp.mode === "daybook" || (CASH_REPORT_MODES as readonly string[]).includes(sp.mode ?? "") ? sp.mode : "dates") as CashReportMode | "daybook";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : monthStart();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today();
  const dated = mode === "dates" || mode === "unpaid" || mode === "daybook";
  const report = mode === "daybook" ? null : await cashReport(prisma, mode, { from, to });
  const book = mode === "daybook" ? await cashDayBook(prisma, { from, to }) : null;
  const rows = report?.rows ?? book ?? [];
  const totals = report?.totals ?? { count: rows.length, total: rows.reduce((t, r) => t + Number(r.total), 0), paid: rows.reduce((t, r) => t + Number(r.paid), 0), remaining: rows.reduce((t, r) => t + Number(r.remaining), 0) };
  const href = (m: string) => `/dashboard/sales/cash-report?mode=${m}&from=${from}&to=${to}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cash Report</h1>
          <p className="text-sm text-muted-foreground">Cash sales: what was billed, taken at the counter and later, and what is still owed. Open a bill to take the rest (Cash Update).</p>
        </div>
        <PrintButton />
      </div>

      <nav aria-label="Report" className="flex flex-wrap gap-1 print:hidden">
        {(["dates", "owing", "unpaid", "all", "daybook"] as const).map((m) => (
          <Link key={m} href={href(m)} aria-current={m === mode ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${m === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{LABEL[m]}</Link>
        ))}
      </nav>

      {dated && (
        <form className="flex flex-wrap items-end gap-2 print:hidden" action="/dashboard/sales/cash-report">
          <input type="hidden" name="mode" value={mode} />
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">From</span>
            <input type="date" name="from" defaultValue={from} className="h-9 rounded-md border bg-background px-2" /></label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">To</span>
            <input type="date" name="to" defaultValue={to} className="h-9 rounded-md border bg-background px-2" /></label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Show</button>
        </form>
      )}

      <Card className="paper">
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-semibold">{LABEL[mode]}{dated ? ` · ${formatDate(from)} to ${formatDate(to)}` : ""}</p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" aria-label="Totals">
            {[["Bills", String(totals.count)], ["Billed", formatCurrency(totals.total)], ["Received", formatCurrency(totals.paid)], ["Still owed", formatCurrency(totals.remaining)]].map(([k, v]) => (
              <div key={k} className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <div className="relative overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead><TableHead>Date</TableHead><TableHead>Name</TableHead><TableHead>Made by</TableHead>
                  <TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No cash sales here</TableCell></TableRow>}
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell><Link className="font-medium text-primary hover:underline" href={`/dashboard/sales/desk?kind=cash&id=${r.id}`}>{r.docNo}</Link></TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell>{r.customer}</TableCell>
                      <TableCell>{r.madeBy}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(r.total))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(r.paid))}</TableCell>
                      <TableCell className={`text-right tabular-nums ${Number(r.remaining) > 0 ? "font-semibold text-amber-700" : ""}`}>{formatCurrency(Number(r.remaining))}</TableCell>
                    </TableRow>
                    {"lines" in r && (r.lines as { item: string; quantity: string; price: string; amount: string; remarks: string | null }[]).map((l, i) => (
                      <TableRow key={`${r.id}-${i}`} className="text-xs text-muted-foreground">
                        <TableCell />
                        <TableCell colSpan={3}>{l.item}{l.remarks ? ` · ${l.remarks}` : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(Number(l.price))}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(Number(l.amount))}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
