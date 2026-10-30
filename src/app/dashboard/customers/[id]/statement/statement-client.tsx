"use client";

import { useRouter } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Row { date: string; docId: string; docNo: string; kind: string; remarks: string | null; debit: string; credit: string; balance: string; remaining?: string }
interface Statement {
  customer: { id: string; name: string; phone: string | null; address: string | null };
  from: string | null; to: string | null;
  opening: string; rows: Row[]; totalDebit: string; totalCredit: string; closing: string;
}

const rs = (v: string | number) => formatCurrency(Math.abs(Number(v)));
const signed = (v: string) => (Number(v) < 0 ? `${rs(v)} Cr` : rs(v));

/** Customer statement from Books: every bill, payment, refund and credit with a running balance (Report 28 §5). */
export default function StatementClient({ statement: st, businessName }: { statement: Statement; businessName: string }) {
  const router = useRouter();
  const period = (from: string | null, to: string | null) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    router.push(`/dashboard/customers/${st.customer.id}/statement?${q.toString()}`);
  };
  const pdfQuery = new URLSearchParams({ ...(st.from ? { from: st.from } : {}), ...(st.to ? { to: st.to } : {}) }).toString();

  return (
    <div className="bg-white text-black min-h-screen p-8 print:p-0">
      <div className="max-w-4xl mx-auto border print:border-0 rounded-lg p-8 print:p-0">
        <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
          <div>
            <p className="text-sm font-semibold text-gray-600">{businessName}</p>
            <h1 className="text-3xl font-bold uppercase text-gray-800 tracking-wider">Account Statement</h1>
            <p className="text-gray-500 mt-1">{st.from || st.to ? `${st.from ? formatDate(st.from) : "Start"} to ${st.to ? formatDate(st.to) : "today"}` : "All entries"} · printed {formatDate(new Date())}</p>
          </div>
          <div className="print:hidden flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.back()}>Back</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
            <a className={buttonVariants({})} href={`/api/sales/statement/${st.customer.id}/pdf${pdfQuery ? `?${pdfQuery}` : ""}`} download><Download className="mr-2 h-4 w-4" /> Download PDF</a>
          </div>
        </div>

        <div className="print:hidden mb-6 flex flex-wrap items-end gap-2 text-sm">
          <label className="space-y-1"><span className="block text-gray-500">From</span><Input type="date" defaultValue={st.from ?? ""} onChange={(e) => period(e.target.value || null, st.to)} /></label>
          <label className="space-y-1"><span className="block text-gray-500">To</span><Input type="date" defaultValue={st.to ?? ""} onChange={(e) => period(st.from, e.target.value || null)} /></label>
        </div>

        <div className="flex flex-wrap justify-between items-end gap-4 border-b pb-6 mb-6">
          <div>
            <h3 className="font-semibold text-gray-500 uppercase text-xs tracking-wider mb-2">Customer</h3>
            <p className="text-xl font-bold">{st.customer.name}</p>
            {st.customer.phone && <p className="text-gray-600">{st.customer.phone}</p>}
            {st.customer.address && <p className="text-gray-600">{st.customer.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-gray-500 text-sm">Opening balance {signed(st.opening)}</p>
            <p className="text-2xl font-bold">{Number(st.closing) >= 0 ? "Amount due" : "Credit"} {rs(st.closing)}</p>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Document</TableHead><TableHead>Details</TableHead>
              <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {st.rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-gray-500 py-6">No entries in this period</TableCell></TableRow>
            ) : st.rows.map((r, i) => (
              <TableRow key={`${r.docId}-${i}`}>
                <TableCell>{formatDate(r.date)}</TableCell>
                <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                <TableCell>{r.kind}{r.remaining !== undefined && Number(r.remaining) > 0 ? ` · owes ${rs(r.remaining)}` : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.debit) ? rs(r.debit) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.credit) ? rs(r.credit) : ""}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{signed(r.balance)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold">
              <TableCell colSpan={3}>Totals</TableCell>
              <TableCell className="text-right tabular-nums">{rs(st.totalDebit)}</TableCell>
              <TableCell className="text-right tabular-nums">{rs(st.totalCredit)}</TableCell>
              <TableCell className="text-right tabular-nums">{signed(st.closing)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="mt-4 text-xs text-gray-500">Debit: bills charged to the customer. Credit: payments and returns. Cr: in the customer&apos;s favour.</p>
      </div>
    </div>
  );
}
