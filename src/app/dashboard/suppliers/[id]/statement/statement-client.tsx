"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatPaisa } from "@/lib/utils";

export interface SupplierStatement {
  supplier: { id: string; name: string; phone: string | null; contactPerson: string | null };
  partyCode: string | null; from: string | null; to: string | null; opening: string; closing: string; totalDebit: string; totalCredit: string;
  rows: { date: string; docId: string; docNo: string; kind: string; reference: string | null; remarks: string | null; debit: string; credit: string; balance: string; remaining?: string }[];
}

const rs = (v: string | number) => formatPaisa(v);
/** Positive: owed to the supplier; "Dr": the supplier owes the business. */
const owed = (v: string) => (Number(v) < 0 ? `${rs(-Number(v))} Dr` : rs(v));

export default function StatementClient({ statement: st }: { statement: SupplierStatement }) {
  const router = useRouter();
  const [from, setFrom] = useState(st.from ?? "");
  const [to, setTo] = useState(st.to ?? "");
  const range = `${from ? `from=${from}&` : ""}${to ? `to=${to}&` : ""}`;
  const pdf = `/api/suppliers/${st.supplier.id}/statement?${range}format=pdf`;
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to supplier" onClick={() => router.push(`/dashboard/suppliers/${st.supplier.id}`)}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Statement: {st.supplier.name}</h1>
            <p className="text-sm text-muted-foreground">{st.partyCode} · positive balance = owed to the supplier</p>
          </div>
        </div>
        <div className="flex gap-2">
          <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`${pdf}&inline=1`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" aria-hidden /> Print</a>
          <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={pdf} download><Download className="h-4 w-4" aria-hidden /> PDF</a>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1"><Label htmlFor="st-from">From</Label><Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="st-to">To</Label><Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={() => router.push(`/dashboard/suppliers/${st.supplier.id}/statement?${range}`)}>Show</Button>
          <div className="ml-auto text-sm">Opening <b className="tabular-nums">{owed(st.opening)}</b> · Closing <b className="tabular-nums">{owed(st.closing)}</b></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Document</TableHead><TableHead>Details</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow className="bg-muted/30"><TableCell colSpan={5} className="text-sm">Opening balance</TableCell><TableCell className="text-right tabular-nums">{owed(st.opening)}</TableCell></TableRow>
              {st.rows.map((r) => (
                <TableRow key={`${r.docId}-${r.date}-${r.debit}-${r.credit}`}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  <TableCell>{r.kind === "Purchase bill" ? <a className="font-mono text-xs hover:underline" href={`/dashboard/purchases/${r.docId}`}>{r.docNo}</a> : <span className="font-mono text-xs">{r.docNo}</span>}</TableCell>
                  <TableCell className="text-sm">{r.kind}{r.reference ? ` (${r.reference})` : ""}{r.remaining !== undefined && Number(r.remaining) > 0 ? <span className="text-xs text-muted-foreground"> · payable {rs(r.remaining)}</span> : null}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.debit) ? rs(r.debit) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.credit) ? rs(r.credit) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{owed(r.balance)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold"><TableCell colSpan={3}>Totals</TableCell><TableCell className="text-right tabular-nums">{rs(st.totalDebit)}</TableCell><TableCell className="text-right tabular-nums">{rs(st.totalCredit)}</TableCell><TableCell className="text-right tabular-nums">{owed(st.closing)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="border-t p-3 text-xs text-muted-foreground">Credit: purchase bills and refunds received from the supplier. Debit: payments and goods returned. Cancelled documents are left out.</p>
        </CardContent>
      </Card>
    </div>
  );
}
