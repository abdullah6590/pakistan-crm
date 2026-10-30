"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, BookOpen, FileText, History, Pencil, Plus, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatPaisa } from "@/lib/utils";
import { PURCHASE_STATUS, type PurchaseRow } from "../../purchases/purchase-bills-client";
import { SupplierForm, type SupplierDetails } from "../supplier-form";

export interface Profile {
  account: {
    supplier: SupplierDetails & { id: string; isActive: boolean; createdAt: string };
    partyCode: string | null; balance: string; payable: string;
    bills: { id: string; docNo: string; vendorBillNo: string | null; remaining: string }[];
    credit: { sourceId: string; docNo: string; kind: string; unapplied: string }[];
  };
  bills: PurchaseRow[];
  payments: { id: string; docNo: string; date: string; status: string; kind: string; account: string; reference: string | null; amount: string; unapplied: string; bills: { id: string; docNo: string; amount: string }[] }[];
  returns: { id: string; docNo: string; date: string; total: string; status: string; returnOf: { id: string; docNo: string } | null }[];
  history: { id: string; at: string; action: string; by: string; reason: string | null; before: string | null; after: string | null }[];
  opening: { id: string; docNo: string; total: string; date: string } | null;
}

const rs = (v: string | number) => formatPaisa(v);
const HISTORY: Record<string, string> = { CREATE: "Added", UPDATE: "Details changed", ARCHIVE: "Archived", RESTORE: "Brought back" };

function changes(h: Profile["history"][number]) {
  try {
    const before = JSON.parse(h.before ?? "{}");
    const after = JSON.parse(h.after ?? "{}");
    return Object.keys(after).filter((k) => k !== "customFields").map((k) => `${k}: ${before[k] ?? "-"} → ${after[k] ?? "-"}`).join("; ");
  } catch {
    return "";
  }
}

export default function SupplierProfile({ profile, canEdit, canArchive, canPay, canBuy, canSeePayments, isAdmin }: {
  profile: Profile; canEdit: boolean; canArchive: boolean; canPay: boolean; canBuy: boolean; canSeePayments: boolean; isAdmin: boolean;
}) {
  const router = useRouter();
  const { account } = profile;
  const s = account.supplier;
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | "archive" | "opening">(null);
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState({ side: "owed", amount: "", date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const custom: { label: string; value: string }[] = (() => { try { return JSON.parse(s.customFields ?? "[]"); } catch { return []; } })();
  const owedToThem = Number(account.balance) >= 0;

  const send = async (url: string, method: string, body: unknown, ok: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast.success(ok);
      setDialog(null);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to Suppliers" onClick={() => router.push("/dashboard/suppliers")}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{s.name}</h1>
              {account.partyCode && <Badge variant="outline" className="font-mono">{account.partyCode}</Badge>}
              {!s.isActive && <Badge variant="secondary">archived</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{[s.contactPerson, s.phone, s.email, s.city].filter(Boolean).join(" · ") || "No contact details yet"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canBuy && s.isActive && <Button className="gap-2" onClick={() => router.push(`/dashboard/purchases/new?supplierId=${s.id}`)}><Plus className="h-4 w-4" aria-hidden /> New purchase</Button>}
          {canPay && <Button variant="outline" className="gap-2" onClick={() => router.push(`/dashboard/purchases/pay?supplierId=${s.id}`)}><Wallet className="h-4 w-4" aria-hidden /> Pay supplier</Button>}
          <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`/dashboard/suppliers/${s.id}/statement`}><FileText className="h-4 w-4" aria-hidden /> Statement</a>
          <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`/dashboard/suppliers/${s.id}/ledger`}><BookOpen className="h-4 w-4" aria-hidden /> Ledger</a>
          {canEdit && <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>}
          {canArchive && <Button variant="outline" className="gap-2" onClick={() => { setReason(""); setDialog("archive"); }}>{s.isActive ? <><Archive className="h-4 w-4" aria-hidden /> Archive</> : <><ArchiveRestore className="h-4 w-4" aria-hidden /> Bring back</>}</Button>}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{owedToThem ? "You owe this supplier" : "This supplier owes you"}</p><p className="text-xl font-bold tabular-nums">{rs(Math.abs(Number(account.balance)))}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Bills still payable</p><p className="text-xl font-bold tabular-nums">{rs(account.payable)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Advances and returns not yet used</p><p className="text-xl font-bold tabular-nums">{rs(account.credit.reduce((t, c) => t + Number(c.unapplied), 0))}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Purchase bills</p><p className="text-xl font-bold">{profile.bills.filter((b) => b.status === "POSTED").length}</p></CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {([["Company", s.company], ["Contact person", s.contactPerson], ["Phone", s.phone], ["E-mail", s.email], ["Address", s.address], ["City", s.city], ["Country", s.country], ["Tax / registration", s.taxNumber]] as const)
              .filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="text-muted-foreground">{k}:</span> {v}</div>)}
            {custom.map((c) => <div key={c.label}><span className="text-muted-foreground">{c.label}:</span> {c.value}</div>)}
            {s.notes && <p className="pt-2 text-muted-foreground italic">{s.notes}</p>}
            <div className="pt-3">
              {profile.opening
                ? <p className="text-xs text-muted-foreground">Opening balance {profile.opening.docNo}: {rs(profile.opening.total)} on {formatDate(profile.opening.date)}</p>
                : isAdmin && <Button variant="outline" size="sm" onClick={() => { setReason(""); setDialog("opening"); }}>Enter opening balance</Button>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Purchase bills</CardTitle></CardHeader>
          <CardContent className="p-0">
            {profile.bills.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No purchase bills yet.</p> : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Supplier bill</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Payable</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {profile.bills.map((b) => {
                      const st = PURCHASE_STATUS[b.paymentStatus] ?? PURCHASE_STATUS.UNPAID;
                      return (
                        <TableRow key={b.id}>
                          <TableCell><a className="font-mono text-xs hover:underline" href={`/dashboard/purchases/${b.id}`}>{b.docNo}</a></TableCell>
                          <TableCell className="text-xs">{b.vendorBillNo ?? "-"}</TableCell>
                          <TableCell className="text-xs">{formatDate(b.date)}{b.overdue && <Badge variant="destructive" className="ml-1">overdue</Badge>}</TableCell>
                          <TableCell className="text-right tabular-nums">{rs(b.total)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rs(b.remaining)}</TableCell>
                          <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canSeePayments && (
        <Card>
          <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
          <CardContent className="p-0">
            {profile.payments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No payments yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Voucher</TableHead><TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Reference</TableHead><TableHead>For bills</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {profile.payments.map((p) => (
                    <TableRow key={p.id} className={p.status === "CANCELLED" ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{p.docNo}{p.kind === "REFUND_RECEIVED" && <span className="font-sans text-muted-foreground"> refund in</span>}{p.status === "CANCELLED" && <Badge variant="destructive" className="ml-1">cancelled</Badge>}</TableCell>
                      <TableCell className="text-xs">{formatDate(p.date)}</TableCell>
                      <TableCell className="text-xs">{p.account}</TableCell>
                      <TableCell className="text-xs">{p.reference ?? ""}</TableCell>
                      <TableCell className="text-xs">{p.bills.map((b) => `${b.docNo} ${rs(b.amount)}`).join(", ") || (Number(p.unapplied) > 0 ? "advance" : "")}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(p.amount)}</TableCell>
                      <TableCell className="text-right"><a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/api/purchases/payments/${p.id}/pdf?inline=1`} target="_blank" rel="noreferrer">PDF</a></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {profile.returns.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Goods returned</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {profile.returns.map((r) => (
              <div key={r.id} className="flex justify-between border-b pb-1 last:border-0">
                <span className="font-mono text-xs">{r.docNo}{r.returnOf ? ` against ${r.returnOf.docNo}` : ""}{r.status === "CANCELLED" ? " (cancelled)" : ""}</span>
                <span className="text-xs">{formatDate(r.date)} · <span className="tabular-nums">{rs(r.total)}</span></span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" aria-hidden /> History</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {profile.history.length === 0 && <p className="text-muted-foreground">No changes recorded.</p>}
          {profile.history.map((h) => (
            <div key={h.id} className="border-b pb-1 last:border-0">
              {formatDate(h.at)} · {h.by} · {HISTORY[h.action] ?? h.action}{h.reason ? ` — ${h.reason}` : ""}
              {h.action === "UPDATE" && <div className="text-xs text-muted-foreground">{changes(h)}</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      {editing && <SupplierForm open initial={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh(); }} />}

      <Dialog open={dialog === "archive"} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>{s.isActive ? `Archive ${s.name}?` : `Bring back ${s.name}?`}</DialogTitle>
          <DialogDescription>{s.isActive ? "Archived suppliers get no new bills. Their bills, payments and balance stay, and what is owed can still be paid." : "The supplier can get new bills again."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm"><Label htmlFor="ar-reason">Reason</Label><Input id="ar-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
          <Button disabled={busy || reason.trim().length < 3} onClick={() => send(`/api/suppliers/${s.id}`, "PATCH", { active: !s.isActive, reason }, s.isActive ? "Supplier archived" : "Supplier brought back")}>{s.isActive ? "Archive" : "Bring back"}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={dialog === "opening"} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>Opening balance for {s.name}</DialogTitle>
          <DialogDescription>Entered once, by an administrator, with where it comes from. It can then be paid like a bill. To change it later, cancel it in Books and enter it again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex gap-4">
            <label className="flex items-center gap-2"><input type="radio" name="ob-side" checked={opening.side === "owed"} onChange={() => setOpening({ ...opening, side: "owed" })} /> The business owed the supplier</label>
            <label className="flex items-center gap-2"><input type="radio" name="ob-side" checked={opening.side === "advance"} onChange={() => setOpening({ ...opening, side: "advance" })} /> The supplier held an advance</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="ob-amount">Amount (Rs)</Label><Input id="ob-amount" inputMode="decimal" value={opening.amount} onChange={(e) => setOpening({ ...opening, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            <div className="space-y-1"><Label htmlFor="ob-date">As on</Label><Input id="ob-date" type="date" value={opening.date} onChange={(e) => setOpening({ ...opening, date: e.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="ob-reason">Where it comes from (at least 10 characters)</Label><Input id="ob-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. old register page 14, agreed with supplier on 20 Oct" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
          <Button disabled={busy || !(Number(opening.amount) > 0) || reason.trim().length < 10}
            onClick={() => send(`/api/suppliers/${s.id}/opening-balance`, "POST", { date: opening.date, [opening.side === "owed" ? "owed" : "advance"]: opening.amount, reason, requestId: crypto.randomUUID() }, "Opening balance entered")}>
            Enter opening balance
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
