"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Download, Pencil, Printer, Wallet, Ban, History, Receipt } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { quantityLabel } from "@/lib/domain/units";
import { BILL_STATUS } from "../bills-client";

interface Line { id: string; lineNo: number; description: string; quantity: string; loose: string; baseQuantity: string; unit: string; unitPrice: string | null; amount: string | null; component: { sku: string } | null }
interface Payment { allocationId: string; receiptId: string; receiptNo: string; date: string; method: string; amount: string; source: string }
interface Version { id: string; docNo: string; total: string; status: string; date: string; current: boolean }
interface Event { id: string; at: string; action: string; by: string; reason: string | null; documentId: string }

export interface BookBill {
  doc: { id: string; docNo: string; type: string; status: string; date: string; revision: number; cancelReason: string | null; lines: Line[]; supersededBy: { id: string; docNo: string } | null };
  customerName: string; customerPhone: string | null; customerId: string | null; notes: string | null;
  total: string; paid: string; remaining: string; status: string;
  payments: Payment[]; versions: Version[]; history: Event[]; madeBy: string; words: string;
  businessName: string; businessAddress: string;
}

const rs = (v: string | number | null | undefined) => formatCurrency(Number(v ?? 0));
const ACTION_LABEL: Record<string, string> = {
  POST: "Saved", AMEND: "Corrected (new revision made)", CANCEL: "Cancelled", ALLOCATIONS_MOVED: "Payments moved to the new revision", PRINT: "Printed",
};
const cell = "border-b border-dotted border-gray-400 px-2 py-1";
const num = `${cell} text-right tabular-nums`;

export default function BookBillClient({ bill, canEdit, canReceive, canCancel, printedBy }: { bill: BookBill; canEdit: boolean; canReceive: boolean; canCancel: boolean; printedBy: string }) {
  const router = useRouter();
  const { doc } = bill;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const st = BILL_STATUS[bill.status] ?? BILL_STATUS.UNPAID;
  const isInvoice = doc.type === "SALE_INVOICE";
  const current = bill.versions.find((v) => v.current);
  const revisionNote = doc.revision > 0 ? `Revision R${doc.revision} of ${doc.docNo.split("/")[0]}` : null;

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/${doc.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not cancel the bill");
      toast.success(`${doc.docNo} cancelled${bill.payments.length && isInvoice ? "; its payments are now the customer's credit" : ""}`);
      setCancelOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the bill");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ─── Screen ─────────────────────────────────────────── */}
      <div className="space-y-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Back to Sales" onClick={() => router.push("/dashboard/sales")}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{isInvoice ? "Invoice" : "Cash sale"} {doc.docNo}</h1>
                <Badge variant={st.variant}>{st.label}</Badge>
                {revisionNote && <Badge variant="outline">{revisionNote}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{formatDate(doc.date)} · {bill.customerName} · made by {bill.madeBy}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canReceive && bill.status !== "PAID" && (
              <Button className="gap-2" onClick={() => router.push(`/dashboard/sales/payments?customerId=${bill.customerId}&invoice=${doc.id}`)}>
                <Wallet className="h-4 w-4" /> Receive payment
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" className="gap-2" onClick={() => router.push(`/dashboard/sales/${doc.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit Bill
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
            <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`/api/sales/${doc.id}/pdf`} download={`Bill-${doc.docNo.replace("/", "-")}.pdf`}>
              <Download className="h-4 w-4" /> Download PDF
            </a>
            {canCancel && (
              <Button variant="outline" className="gap-2 text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4" /> Cancel bill</Button>
            )}
          </div>
        </div>

        {doc.status === "CANCELLED" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            {doc.supersededBy
              ? <>This is an earlier version. The current bill is <button className="underline" onClick={() => router.push(`/dashboard/sales/${doc.supersededBy!.id}`)}>{doc.supersededBy.docNo}</button>.</>
              : <>This bill was cancelled{doc.cancelReason ? `: ${doc.cancelReason}` : ""}. Its stock and accounts were reversed.</>}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          {[["Bill total", bill.total], ["Received", bill.paid], ["Remaining", bill.remaining]].map(([label, v]) => (
            <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold tabular-nums">{rs(v)}</p></CardContent></Card>
          ))}
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><p className="text-xl font-bold">{st.label}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {doc.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell><div className="font-medium">{l.description}</div>{l.component?.sku && <div className="text-xs text-muted-foreground font-mono">{l.component.sku}</div>}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantityLabel(l.quantity, l.unit, l.loose)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(l.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{rs(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {bill.notes && <p className="border-t p-4 text-sm text-muted-foreground italic">{bill.notes}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-muted-foreground" /> Payments</CardTitle></CardHeader>
          <CardContent className="p-0">
            {bill.payments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No payment received yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Receipt</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {bill.payments.map((p) => (
                    <TableRow key={p.allocationId || p.receiptId}>
                      <TableCell>{formatDate(p.date)}</TableCell>
                      <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{p.receiptNo}</code></TableCell>
                      <TableCell>{p.method}{p.source === "APPLY_CREDIT" ? " (from credit)" : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(p.amount)}</TableCell>
                      <TableCell className="text-right">
                        {isInvoice && <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/api/sales/receipts/${p.receiptId}/pdf`} download>Receipt PDF</a>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /> Versions and history</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {bill.versions.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {bill.versions.map((v) => (
                  <button key={v.id} onClick={() => router.push(`/dashboard/sales/${v.id}`)} className={`rounded border px-2 py-1 text-xs ${v.id === doc.id ? "bg-muted font-semibold" : ""}`}>
                    {v.docNo} · {rs(v.total)} · {v.status === "POSTED" ? "current" : "replaced/cancelled"}
                  </button>
                ))}
              </div>
            )}
            {bill.history.map((h) => (
              <div key={h.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                <span>{formatDate(h.at)} · {h.by} · {ACTION_LABEL[h.action] ?? h.action}{h.reason ? ` — ${h.reason}` : ""}</span>
                <span className="text-xs text-muted-foreground">{bill.versions.find((v) => v.id === h.documentId)?.docNo}</span>
              </div>
            ))}
            {current && current.id !== doc.id && <p className="text-muted-foreground">The current version is {current.docNo}.</p>}
          </CardContent>
        </Card>
      </div>

      {/* ─── Printed bill ───────────────────────────────────── */}
      <div className="hidden print:block bg-white text-black text-sm">
        <div className="text-center">
          <div className="text-xl font-bold">{bill.businessName}</div>
          {bill.businessAddress && <div>{bill.businessAddress}</div>}
          <div className="mt-1 text-lg font-semibold uppercase tracking-wide">{isInvoice ? "Sale invoice" : "Cash sale"}</div>
          {revisionNote && <div className="text-xs">{revisionNote}</div>}
          {doc.status === "CANCELLED" && <div className="font-bold text-red-700">CANCELLED</div>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
          <div><b>Bill No:</b> {doc.docNo}</div>
          <div className="text-right"><b>Date:</b> {formatDate(doc.date)}</div>
          <div><b>Customer:</b> {bill.customerName}{bill.customerPhone ? ` (${bill.customerPhone})` : ""}</div>
          <div className="text-right"><b>Status:</b> {st.label}</div>
        </div>
        <table className="mt-4 w-full border-collapse">
          <thead><tr className="border-y border-black"><th className="px-2 py-1 text-left">S.No</th><th className="px-2 py-1 text-left">Item</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-right">Rate</th><th className="px-2 py-1 text-right">Amount</th></tr></thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.id} className="break-inside-avoid">
                <td className={cell}>{l.lineNo}</td>
                <td className={cell}>{l.description}{l.component?.sku ? ` (${l.component.sku})` : ""}</td>
                <td className={num}>{Number(l.baseQuantity)}</td>
                <td className={num}>{rs(l.unitPrice)}</td>
                <td className={num}>{rs(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div className="space-y-1">
            <div><b>Amount in words:</b> {bill.words}</div>
            {bill.notes && <div><b>Notes:</b> {bill.notes}</div>}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between border-b border-black font-bold"><span>Total</span><span className="tabular-nums">{rs(bill.total)}</span></div>
            {bill.payments.map((p) => (
              <div key={p.allocationId || p.receiptId} className="flex justify-between text-xs"><span>{formatDate(p.date)} {p.receiptNo} ({p.method})</span><span className="tabular-nums">-{rs(p.amount)}</span></div>
            ))}
            <div className="flex justify-between border-t border-black font-bold"><span>Remaining</span><span className="tabular-nums">{rs(bill.remaining)}</span></div>
          </div>
        </div>
        <div className="mt-6 text-xs text-gray-600">Printed by {printedBy} · {formatDate(new Date())}</div>
      </div>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <DialogHeader><DialogTitle>Cancel {doc.docNo}?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p>Stock comes back and the bill&apos;s accounts are reversed. Nothing is deleted; the bill stays in history as cancelled.{isInvoice && bill.payments.length > 0 ? " Payments already received become the customer's credit, which you can apply to another bill or refund." : ""}</p>
          <div className="space-y-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. made for the wrong customer" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep bill</Button>
          <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={cancel}>{busy ? "Cancelling..." : "Cancel bill"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
