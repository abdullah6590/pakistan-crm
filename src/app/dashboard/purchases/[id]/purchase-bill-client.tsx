"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Ban, Download, History, Paperclip, Pencil, Printer, Receipt, Truck, Undo2, Wallet, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatPaisa } from "@/lib/utils";
import { quantityLabel } from "@/lib/domain/units";
import { PURCHASE_STATUS } from "../purchase-bills-client";

interface Line { id: string; lineNo: number; description: string; quantity: string; unit: string; loose: string; baseQuantity: string; unitPrice: string | null; amount: string | null; component: { sku: string; name: string } | null }
interface Payment { allocationId: string; sourceId: string; docNo: string; date: string; kind: "PAYMENT" | "RETURN"; method: string; reference: string | null; amount: string; source: string }
export interface PurchaseBill {
  doc: {
    id: string; docNo: string; revision: number; date: string; status: string; createdById: string; remarks: string | null; cancelReason: string | null;
    vendorBillNo: string | null; vendorBillDate: string | null; dueDate: string | null; biltyNo: string | null; biltyDate: string | null;
    lines: Line[]; supersededBy: { id: string; docNo: string } | null; returns: { id: string; docNo: string; date: string; total: string; status: string }[];
  };
  supplier: { id: string; name: string; phone: string | null; contactPerson: string | null } | null;
  supplierName: string; supplierCode: string;
  total: string; paid: string; returned: string; remaining: string; status: string; overdue: boolean;
  payments: Payment[];
  charges: { id: string; kind: string; amount: string; description: string; status: string }[];
  versions: { id: string; docNo: string; total: string; status: string; current: boolean }[];
  history: { id: string; at: string; action: string; by: string; reason: string | null; documentId: string }[];
  attachments: { id: string; fileName: string; mimeType: string; size: number; note: string | null; createdAt: string; by: string }[];
  madeBy: string;
}

const ACTION_LABEL: Record<string, string> = {
  POST: "Saved", AMEND: "Corrected (new revision made)", CANCEL: "Cancelled", ALLOCATIONS_MOVED: "Payments moved to the new revision", PRINT: "Printed",
  ATTACH: "Document attached", DETACH: "Document removed", ALLOCATE: "Payment linked",
};
const rs = (v: string | number | null) => formatPaisa(v ?? 0);

export default function PurchaseBillClient({ bill, canEdit, canPay, canReturn, canCancel, canAttach, canSeePayments }: {
  bill: PurchaseBill; canEdit: boolean; canPay: boolean; canReturn: boolean; canCancel: boolean; canAttach: boolean; canSeePayments: boolean;
}) {
  const router = useRouter();
  const { doc } = bill;
  const st = PURCHASE_STATUS[bill.status] ?? PURCHASE_STATUS.UNPAID;
  const revisionNote = doc.revision > 0 ? `Revision R${doc.revision} of ${doc.docNo.split("/")[0]}` : null;
  const [dialog, setDialog] = useState<null | "cancel" | "return">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<number, string>>({});
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [returnId, setReturnId] = useState(() => crypto.randomUUID());
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");

  const send = async (url: string, init: RequestInit, ok: (data: Record<string, unknown>) => string) => {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast.success(ok(data), { duration: 8000 });
      setDialog(null);
      setReason("");
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => send(`/api/purchases/${doc.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) },
    () => `${doc.docNo} cancelled${bill.payments.some((p) => p.kind === "PAYMENT") ? "; its payments are now the supplier's credit" : ""}`);

  const returnGoods = async () => {
    const lines = Object.entries(returnQty).filter(([, q]) => Number(q) > 0).map(([lineNo, q]) => ({ lineNo: Number(lineNo), quantity: q, unit: doc.lines.find((l) => l.lineNo === Number(lineNo))?.unit }));
    if (!lines.length) { toast.error("Enter what goes back"); return; }
    const ok = await send(`/api/purchases/${doc.id}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: returnDate, lines, remarks: reason, requestId: returnId }) },
      (d) => {
        const r = d as { purchaseReturn: { docNo: string }; settled?: string; credit?: string };
        return `Return ${r.purchaseReturn.docNo} saved${Number(r.credit ?? 0) > 0 ? `; ${rs(r.credit ?? 0)} is now the supplier's credit` : ""}`;
      });
    if (ok) { setReturnQty({}); setReturnId(crypto.randomUUID()); }
  };

  const upload = async () => {
    const f = file.current?.files?.[0];
    if (!f) { toast.error("Choose a file"); return; }
    const form = new FormData();
    form.append("file", f);
    if (note.trim()) form.append("note", note.trim());
    const ok = await send(`/api/purchases/${doc.id}/attachments`, { method: "POST", body: form }, () => `${f.name} attached`);
    if (ok && file.current) { file.current.value = ""; setNote(""); }
  };

  const removeAttachment = async (id: string, name: string) => {
    const why = window.prompt(`Why remove ${name}? (it stays in the history)`);
    if (!why) return;
    await send(`/api/purchases/attachments/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, () => `${name} removed`);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to Purchases" onClick={() => router.push("/dashboard/purchases")}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Purchase bill {doc.docNo}</h1>
              <Badge variant={st.variant}>{st.label}</Badge>
              {bill.overdue && <Badge variant="destructive">overdue</Badge>}
              {revisionNote && <Badge variant="outline">{revisionNote}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatDate(doc.date)} ·{" "}
              {bill.supplier ? <a className="hover:underline" href={`/dashboard/suppliers/${bill.supplier.id}`}>{bill.supplierName}</a> : bill.supplierName}
              {" "}<span className="font-mono text-xs">{bill.supplierCode}</span> · entered by {bill.madeBy}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPay && bill.status !== "PAID" && bill.supplier && (
            <Button className="gap-2" onClick={() => router.push(`/dashboard/purchases/pay?supplierId=${bill.supplier!.id}&bill=${doc.id}`)}><Wallet className="h-4 w-4" aria-hidden /> Pay supplier</Button>
          )}
          {canEdit && <Button variant="outline" className="gap-2" onClick={() => router.push(`/dashboard/purchases/${doc.id}/edit`)}><Pencil className="h-4 w-4" aria-hidden /> Edit bill</Button>}
          {canReturn && <Button variant="outline" className="gap-2" onClick={() => { setReason(""); setDialog("return"); }}><Undo2 className="h-4 w-4" aria-hidden /> Return goods</Button>}
          <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`/api/purchases/${doc.id}/pdf?inline=1`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" aria-hidden /> Print</a>
          <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`/api/purchases/${doc.id}/pdf`} download><Download className="h-4 w-4" aria-hidden /> PDF</a>
          {canCancel && <Button variant="outline" className="gap-2 text-destructive" onClick={() => { setReason(""); setDialog("cancel"); }}><Ban className="h-4 w-4" aria-hidden /> Cancel bill</Button>}
        </div>
      </div>

      {doc.status === "CANCELLED" && (
        <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {doc.supersededBy
            ? <>This is an earlier version. The current bill is <a className="underline" href={`/dashboard/purchases/${doc.supersededBy.id}`}>{doc.supersededBy.docNo}</a>.</>
            : <>This bill was cancelled{doc.cancelReason ? `: ${doc.cancelReason}` : ""}. Its stock and accounts were reversed.</>}
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {([["Bill total", bill.total], ["Paid", bill.paid], ["Goods returned", bill.returned], ["Still payable", bill.remaining]] as const).map(([label, v]) => (
          <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold tabular-nums">{rs(v)}</p></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground" aria-hidden /> Bill details</CardTitle></CardHeader>
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">Supplier bill:</span> {doc.vendorBillNo ?? "-"}{doc.vendorBillDate ? ` of ${formatDate(doc.vendorBillDate)}` : ""}</div>
          <div><span className="text-muted-foreground">Due date:</span> {doc.dueDate ? formatDate(doc.dueDate) : "-"}</div>
          {(doc.biltyNo || doc.biltyDate) && <div><span className="text-muted-foreground">Bilty:</span> {doc.biltyNo ?? ""}{doc.biltyDate ? ` of ${formatDate(doc.biltyDate)}` : ""}</div>}
          {bill.supplier?.contactPerson && <div><span className="text-muted-foreground">Contact:</span> {bill.supplier.contactPerson}{bill.supplier.phone ? `, ${bill.supplier.phone}` : ""}</div>}
          {doc.remarks && <div className="sm:col-span-2 text-muted-foreground italic">{doc.remarks}</div>}
        </CardContent>
      </Card>

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-muted-foreground" aria-hidden /> Paid and returned against this bill</CardTitle></CardHeader>
        <CardContent className="p-0">
          {bill.payments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing paid yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Document</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {bill.payments.map((p) => (
                  <TableRow key={p.allocationId}>
                    <TableCell>{formatDate(p.date)}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{p.docNo}</code></TableCell>
                    <TableCell>{p.method}{p.source === "APPLY_CREDIT" ? " (from credit)" : ""}</TableCell>
                    <TableCell className="text-xs">{p.reference ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(p.amount)}</TableCell>
                    <TableCell className="text-right">
                      {p.kind === "PAYMENT" && canSeePayments && <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/api/purchases/payments/${p.sourceId}/pdf?inline=1`} target="_blank" rel="noreferrer">Voucher PDF</a>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {doc.returns.length > 0 && (
            <p className="border-t p-3 text-xs text-muted-foreground">Returns: {doc.returns.map((r) => `${r.docNo} (${rs(r.total)}${r.status === "CANCELLED" ? ", cancelled" : ""})`).join(", ")}</p>
          )}
        </CardContent>
      </Card>

      {bill.charges.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Charges recorded with this bill</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">Freight, loading and bilty are kept for reference only: they are not in the bill total or the item cost. Posting one as an expense is a separate step in Books → Charges.</p>
            {bill.charges.map((c) => (
              <div key={c.id} className="flex justify-between border-b pb-1 last:border-0"><span>{c.kind.replace("_", " ").toLowerCase()} · {c.description} <Badge variant="outline">{c.status.toLowerCase()}</Badge></span><span className="tabular-nums">{rs(c.amount)}</span></div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden /> Supplier documents</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {bill.attachments.length === 0 && <p className="text-muted-foreground">No documents attached.</p>}
          {bill.attachments.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
              <a className="hover:underline" href={`/api/purchases/attachments/${a.id}?inline=1`} target="_blank" rel="noreferrer">{a.fileName}</a>
              <span className="text-xs text-muted-foreground">{Math.ceil(a.size / 1024)} KB · {a.by} · {formatDate(a.createdAt)}{a.note ? ` · ${a.note}` : ""}</span>
              {canAttach && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${a.fileName}`} onClick={() => removeAttachment(a.id, a.fileName)}><X className="h-4 w-4" aria-hidden /></Button>}
            </div>
          ))}
          {canAttach && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-1"><Label htmlFor="att-file">PDF or picture, up to 5 MB</Label><Input id="att-file" ref={file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" /></div>
              <div className="space-y-1"><Label htmlFor="att-note">Note</Label><Input id="att-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. supplier's bill, delivery note" /></div>
              <Button variant="outline" disabled={busy} onClick={upload}>Attach</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" aria-hidden /> Versions and history</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {bill.versions.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {bill.versions.map((v) => (
                <a key={v.id} href={`/dashboard/purchases/${v.id}`} className={`rounded border px-2 py-1 text-xs ${v.id === doc.id ? "bg-muted font-semibold" : ""}`}>
                  {v.docNo} · {rs(v.total)} · {v.status === "POSTED" ? "current" : "replaced/cancelled"}
                </a>
              ))}
            </div>
          )}
          {bill.history.map((h) => (
            <div key={h.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
              <span>{formatDate(h.at)} · {h.by} · {ACTION_LABEL[h.action] ?? h.action}{h.reason ? ` — ${h.reason}` : ""}</span>
              <span className="text-xs text-muted-foreground">{bill.versions.find((v) => v.id === h.documentId)?.docNo}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={dialog === "cancel"} onClose={() => setDialog(null)}>
        <DialogHeader><DialogTitle>Cancel {doc.docNo}?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p>The stock leaves again and the bill&apos;s accounts are reversed. Nothing is deleted; the bill stays in history as cancelled.{bill.payments.some((p) => p.kind === "PAYMENT") ? " Payments already made become the supplier's credit, to use for another bill or to be refunded." : ""}</p>
          <div className="space-y-1"><Label htmlFor="cancel-reason">Reason</Label><Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered for the wrong supplier" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>Keep bill</Button>
          <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={cancel}>{busy ? "Cancelling..." : "Cancel bill"}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={dialog === "return"} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>Return goods from {doc.docNo}</DialogTitle>
          <DialogDescription>Stock leaves at the price it was bought for. The return lowers what is payable on this bill; anything beyond that becomes the supplier&apos;s credit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {doc.lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
              <Label htmlFor={`ret-${l.lineNo}`}>{l.description} <span className="text-muted-foreground">(bought {quantityLabel(l.quantity, l.unit, l.loose)})</span></Label>
              <Input id={`ret-${l.lineNo}`} inputMode="decimal" placeholder={`0 ${l.unit}`} value={returnQty[l.lineNo] ?? ""} onChange={(e) => setReturnQty({ ...returnQty, [l.lineNo]: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="ret-date">Date</Label><Input id="ret-date" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="ret-reason">Why</Label><Input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged packets" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
          <Button disabled={busy || reason.trim().length < 3} onClick={returnGoods}>{busy ? "Saving..." : "Save return"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
