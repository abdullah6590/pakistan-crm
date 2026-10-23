"use client";

// Charges register. "Record only — not posted to accounts" is the default; "Post as expense" is an explicit
// action. The server refuses duplicate postings, so a double click cannot create two expenses.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money, formatDate } from "@/lib/accounting/meta";

interface ChargeRow {
  id: string; chargeNo: string; kind: string; date: string; amount: string; description: string; reference: string | null;
  status: string; partyName: string | null; partyAccountId: string | null;
  document: { id: string; docNo: string; type: string } | null;
  postings: { id: string; docNo: string; status: string }[];
}
interface AccountOption { id: string; code: string; name: string; kind: string; subType: string | null }
interface DocOption { id: string; docNo: string; type: string; partyAccountId: string | null }

const KIND_LABEL: Record<string, string> = { FREIGHT: "Freight", LOADING: "Loading / unloading", BILTY: "Bilty", OTHER_PURCHASE: "Other purchase charge", PRINTING: "Printing charge" };
const selectClass = "flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";

async function send(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not save");
  return data;
}

function StatusBadge({ c }: { c: ChargeRow }) {
  const active = c.postings.find((p) => p.status === "POSTED");
  if (c.status === "POSTED" && active) return <Badge>Posted as expense · {active.docNo}</Badge>;
  if (c.status === "CANCELLED") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="secondary">Record only — not posted to accounts</Badge>;
}

export default function ChargesClient(props: {
  dateFormat: string; filter: { status: string; kind: string };
  canRecord: boolean; canCancel: boolean; canPost: boolean; canReverse: boolean;
  charges: ChargeRow[]; accounts: AccountOption[]; documents: DocOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: "FREIGHT", date: new Date().toISOString().slice(0, 10), amount: "", description: "", reference: "", documentId: "", partyAccountId: "" });
  const [open, setOpen] = useState<{ id: string; mode: "post" | "reverse" | "cancel" | "edit" } | null>(null);
  const [post, setPost] = useState({ settlement: "PAYABLE", expenseAccountId: "", cashAccountId: "", payeeAccountId: "" });
  const [reason, setReason] = useState("");
  const [edit, setEdit] = useState({ amount: "", description: "" });

  const expenseAccounts = props.accounts.filter((a) => a.kind === "GL" && a.subType === "EXPENSE");
  const cashBank = props.accounts.filter((a) => a.kind === "CASH_BANK");
  const parties = props.accounts.filter((a) => a.kind === "PARTY");
  const docsForKind = props.documents.filter((d) => (form.kind === "PRINTING" ? d.type.startsWith("PRESS_") : d.type === "PURCHASE_INVOICE"));

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (busy) return; // one request at a time; the server also refuses duplicates
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setOpen(null);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {props.canRecord && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Record a charge</CardTitle>
            <p className="text-sm text-muted-foreground">Record only — not posted to accounts. Item cost, stock value, balances, expenses, cash and bank do not change.</p>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-4">
            <div className="space-y-1"><Label>Type</Label>
              <select className={selectClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, documentId: "" })}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-1"><Label>Amount</Label><Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="space-y-1"><Label>Reference</Label><Input placeholder="Bilty no, job, bill no" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            <div className="space-y-1 md:col-span-2"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-1"><Label>Related document (optional)</Label>
              <select className={selectClass} value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })}>
                <option value="">None</option>
                {docsForKind.map((d) => <option key={d.id} value={d.id}>{d.docNo}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Party (optional)</Label>
              <select className={selectClass} value={form.partyAccountId} onChange={(e) => setForm({ ...form, partyAccountId: e.target.value })}>
                <option value="">From the document / none</option>
                {parties.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-4">
              <Button disabled={busy || !form.amount || !form.description.trim()} onClick={() => run(() => send("/api/accounting/charges", {
                kind: form.kind, date: form.date, amount: form.amount, description: form.description, reference: form.reference || undefined,
                documentId: form.documentId || undefined, partyAccountId: form.partyAccountId || undefined,
              }).then(() => setForm({ ...form, amount: "", description: "", reference: "" })), "Charge recorded (not posted)")}>
                <Plus className="mr-1 h-4 w-4" />Record charge
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <form className="flex flex-wrap gap-2">
            <select name="status" defaultValue={props.filter.status} className={`${selectClass} max-w-xs`}>
              <option value="">All statuses</option>
              <option value="RECORDED">Record only</option>
              <option value="POSTED">Posted as expense</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select name="kind" defaultValue={props.filter.kind} className={`${selectClass} max-w-xs`}>
              <option value="">All types</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className={buttonVariants({ variant: "outline" })} type="submit">Filter</button>
          </form>

          {props.charges.length === 0 && <p className="text-sm text-muted-foreground">No charges recorded.</p>}
          {props.charges.map((c) => (
            <div key={c.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{c.chargeNo}</span>
                <span>{formatDate(c.date, props.dateFormat)}</span>
                <span className="font-medium">{KIND_LABEL[c.kind] ?? c.kind}</span>
                <span>{c.description}</span>
                {c.reference && <span className="text-muted-foreground">({c.reference})</span>}
                {c.partyName && <span className="text-muted-foreground">· {c.partyName}</span>}
                {c.document && <Link className="text-primary hover:underline" href={`/dashboard/accounting/documents/${c.document.id}`}>{c.document.docNo}</Link>}
                <span className="ml-auto tabular-nums font-semibold">{money(c.amount)}</span>
                <StatusBadge c={c} />
              </div>
              {c.postings.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Posting history: {c.postings.map((p) => <Link key={p.id} className="mr-2 hover:underline" href={`/dashboard/accounting/documents/${p.id}`}>{p.docNo} ({p.status.toLowerCase()})</Link>)}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {c.status === "RECORDED" && props.canPost && <Button size="sm" onClick={() => { setOpen({ id: c.id, mode: "post" }); setPost({ settlement: "PAYABLE", expenseAccountId: "", cashAccountId: "", payeeAccountId: c.partyAccountId ?? "" }); }}>Post as expense</Button>}
                {c.status === "POSTED" && props.canReverse && <Button size="sm" variant="outline" onClick={() => setOpen({ id: c.id, mode: "reverse" })}>Reverse posting</Button>}
                {c.status !== "CANCELLED" && props.canRecord && (c.status === "RECORDED" || props.canReverse) && <Button size="sm" variant="outline" onClick={() => { setOpen({ id: c.id, mode: "edit" }); setEdit({ amount: c.amount, description: c.description }); }}>Edit</Button>}
                {c.status !== "CANCELLED" && props.canCancel && (c.status === "RECORDED" || props.canReverse) && <Button size="sm" variant="ghost" onClick={() => setOpen({ id: c.id, mode: "cancel" })}>Cancel charge</Button>}
              </div>

              {open?.id === c.id && open.mode === "post" && (
                <div className="grid gap-2 rounded-md bg-muted/40 p-3 md:grid-cols-4">
                  <p className="text-sm md:col-span-4">This posts {money(c.amount)} to an expense account once. Choose whether it was paid now or is still owed.</p>
                  <div className="space-y-1"><Label>Expense account</Label>
                    <select className={selectClass} value={post.expenseAccountId} onChange={(e) => setPost({ ...post, expenseAccountId: e.target.value })}>
                      <option value="">Default for {KIND_LABEL[c.kind]?.toLowerCase()}</option>
                      {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1"><Label>Settlement</Label>
                    <select className={selectClass} value={post.settlement} onChange={(e) => setPost({ ...post, settlement: e.target.value })}>
                      <option value="PAYABLE">Not paid yet (payable)</option>
                      <option value="PAID">Paid now</option>
                    </select>
                  </div>
                  {post.settlement === "PAID" ? (
                    <div className="space-y-1"><Label>Paid from</Label>
                      <select className={selectClass} value={post.cashAccountId} onChange={(e) => setPost({ ...post, cashAccountId: e.target.value })}>
                        <option value="">Choose cash or bank</option>
                        {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-1"><Label>Owed to</Label>
                      <select className={selectClass} value={post.payeeAccountId} onChange={(e) => setPost({ ...post, payeeAccountId: e.target.value })}>
                        <option value="">Choose the payee</option>
                        {parties.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <Button size="sm" disabled={busy} onClick={() => run(() => send(`/api/accounting/charges/${c.id}`, {
                      action: "post", settlement: post.settlement, expenseAccountId: post.expenseAccountId || undefined,
                      cashAccountId: post.settlement === "PAID" ? post.cashAccountId || undefined : undefined,
                      payeeAccountId: post.settlement === "PAYABLE" ? post.payeeAccountId || undefined : undefined,
                    }), "Posted as expense")}><Save className="mr-1 h-4 w-4" />Confirm posting</Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Button>
                  </div>
                </div>
              )}
              {open?.id === c.id && open.mode === "edit" && (
                <div className="grid gap-2 rounded-md bg-muted/40 p-3 md:grid-cols-4">
                  {c.status === "POSTED" && <p className="text-sm md:col-span-4">Saving reverses the current expense posting (both are kept). The charge returns to &quot;record only&quot; and you can post it again.</p>}
                  <Input inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                  <Input className="md:col-span-2" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                  <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2 md:col-span-4">
                    <Button size="sm" disabled={busy || !reason.trim()} onClick={() => run(() => send(`/api/accounting/charges/${c.id}`, { action: "edit", reason, patch: { amount: edit.amount, description: edit.description } }), "Charge updated")}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Button>
                  </div>
                </div>
              )}
              {open?.id === c.id && (open.mode === "reverse" || open.mode === "cancel") && (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-3">
                  <span className="text-sm">{open.mode === "reverse" ? "The expense posting is reversed (kept on record); the charge returns to record only." : c.status === "POSTED" ? "The expense posting is reversed first, then the charge is cancelled." : "The charge is cancelled; nothing was posted."}</span>
                  <Input className="max-w-sm" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(() => send(`/api/accounting/charges/${c.id}`, { action: open.mode, reason }), open.mode === "reverse" ? "Posting reversed" : "Charge cancelled")}>Confirm</Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
