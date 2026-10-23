"use client";

// Sync status and the entries waiting on this computer. Statuses use the wording agreed with the owner.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_TYPES, money, qty } from "@/lib/accounting/meta";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING_SYNC: { label: "Pending Sync", variant: "secondary" },
  SYNCING: { label: "Syncing", variant: "secondary" },
  SYNCED: { label: "Synced", variant: "default" },
  NEEDS_REVIEW: { label: "Needs Review", variant: "destructive" },
  FAILED_RETRY: { label: "Failed — Retry Available", variant: "outline" },
  CANCELLED: { label: "Withdrawn", variant: "outline" },
};

interface Entry {
  id: string; seq: number; type: string; status: string; provisionalRef: string | null; createdById: string; createdAt: string; syncedAt: string | null;
  attempts: number; nextAttemptAt: string | null; lastError: string | null; payload: string; preview: string | null; result: string | null;
}

function describe(e: Entry) {
  const cmd = JSON.parse(e.payload);
  if (e.type === "CREATE_DOCUMENT") return DOCUMENT_TYPES[cmd.docType]?.title ?? cmd.docType;
  if (e.type === "DOCUMENT_ACTION") return `${cmd.action[0].toUpperCase()}${cmd.action.slice(1)} a document`;
  if (e.type === "RECORD_CHARGE") return "Record a charge";
  return `Charge: ${cmd.action}`;
}

export default function SyncClient(props: {
  role: string; deviceCode: string | null; canApprove: boolean; userId: string; isAdmin: boolean;
  summary: Record<string, number>; last: { error?: string; accepted: number; needsReview: number; pulled: number; startedAt: string } | null;
  lastSuccessAt: string | null; entries: Entry[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<Entry | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  async function call(url: string, body?: unknown, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (ok) toast.success(ok);
      router.refresh();
      return data;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pending = (props.summary.PENDING_SYNC ?? 0) + (props.summary.SYNCING ?? 0) + (props.summary.FAILED_RETRY ?? 0);

  if (printing) {
    const p = JSON.parse(printing.preview ?? "{}");
    return (
      <div className="space-y-4">
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={() => setPrinting(null)}>Back</Button>
          <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
        <div className="rounded-lg border bg-white p-6 text-black">
          <div className="text-center text-lg font-bold">{describe(printing)}</div>
          <div className="text-center text-sm font-bold text-red-700">PROVISIONAL — NOT YET SYNCHRONISED · {printing.provisionalRef}</div>
          <div className="mt-1 text-center text-xs">The official number is given when the main server accepts this entry. Amounts are final; cost figures are provisional.</div>
          <div className="mt-4 text-sm">{p.partyName ? <>Party: {p.partyName} · </> : null}Date: {p.date ? new Date(p.date).toLocaleDateString() : "-"}</div>
          {p.lines?.length > 0 && (
            <table className="mt-3 w-full border-collapse text-sm">
              <thead><tr className="border-y border-black"><th className="px-2 text-left">Item</th><th className="px-2 text-right">Qty</th><th className="px-2 text-right">Loose</th><th className="px-2 text-right">Rate</th><th className="px-2 text-right">Amount</th></tr></thead>
              <tbody>{p.lines.map((l: { lineNo: number; description: string; quantity: string; unit: string; loose: string; unitPrice: string; amount: string }) => (
                <tr key={l.lineNo}><td className="px-2">{l.description}</td><td className="px-2 text-right">{qty(l.quantity)} {l.unit}</td><td className="px-2 text-right">{qty(l.loose)}</td><td className="px-2 text-right">{money(l.unitPrice)}</td><td className="px-2 text-right">{money(l.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}
          {p.total && <div className="mt-3 text-right font-bold">Total {money(p.total, 0)}</div>}
          {p.previousBalance !== null && p.previousBalance !== undefined && <div className="text-right text-sm">Previous balance {money(p.previousBalance)} · New balance {money(p.newBalance)} (includes entries on this computer not yet synchronised)</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4 text-sm">
          <div><b>This computer:</b> {props.role === "hub" ? "office server" : "desktop"} {props.deviceCode ?? "(not registered)"}</div>
          <div><b>Waiting to sync:</b> {pending}</div>
          <div><b>Needs review:</b> {props.summary.NEEDS_REVIEW ?? 0}</div>
          <div><b>Last successful sync:</b> {props.lastSuccessAt ? new Date(props.lastSuccessAt).toLocaleString() : "never"}</div>
          {props.last?.error && <div className="text-destructive"><b>Last attempt:</b> {props.last.error}</div>}
          <Button className="ml-auto" size="sm" disabled={busy} onClick={() => call("/api/sync/status", undefined, "Sync finished")}><RefreshCw className="mr-1 h-4 w-4" />Sync now</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Entries made on this computer</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {props.entries.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          {props.entries.map((e) => {
            const p = e.preview ? JSON.parse(e.preview) : null;
            const r = e.result ? JSON.parse(e.result) : null;
            const s = STATUS[e.status] ?? { label: e.status, variant: "outline" as const };
            const cmd = JSON.parse(e.payload);
            const pendingIssue = e.type === "CREATE_DOCUMENT" && ["STOCK_ISSUE", "PRESS_LOSS", "STOCK_ADJUSTMENT"].includes(cmd.docType) && ["PENDING_SYNC", "FAILED_RETRY"].includes(e.status);
            return (
              <div key={e.id} className="space-y-1 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{e.provisionalRef ?? `#${e.seq}`}</span>
                  {r?.docNo && e.status === "SYNCED" && <span className="font-mono text-xs">→ {r.docNo}</span>}
                  <span className="font-medium">{describe(e)}</span>
                  {p?.partyName && <span>· {p.partyName}</span>}
                  {p?.total && <span className="tabular-nums">· {money(p.total, 0)}</span>}
                  <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                  <Badge className="ml-auto" variant={s.variant}>{s.label}</Badge>
                </div>
                {e.lastError && <div className={e.status === "NEEDS_REVIEW" ? "text-destructive" : "text-muted-foreground"}>{e.lastError}</div>}
                {e.status === "FAILED_RETRY" && e.nextAttemptAt && <div className="text-muted-foreground">Next automatic try: {new Date(e.nextAttemptAt).toLocaleTimeString()} (attempt {e.attempts})</div>}
                <div className="flex flex-wrap items-center gap-2">
                  {p?.lines && <Button size="sm" variant="outline" onClick={() => setPrinting(e)}><Printer className="mr-1 h-4 w-4" />Provisional print</Button>}
                  {pendingIssue && props.canApprove && e.createdById !== props.userId && (
                    <Button size="sm" disabled={busy} onClick={() => call("/api/sync/outbox", { action: "approve", id: e.id }, "Approval queued")}>Approve</Button>
                  )}
                  {["PENDING_SYNC", "FAILED_RETRY", "NEEDS_REVIEW"].includes(e.status) && (e.createdById === props.userId || props.isAdmin) && (
                    <>
                      <Input className="h-8 max-w-xs" placeholder="Reason to withdraw" value={reason[e.id] ?? ""} onChange={(ev) => setReason({ ...reason, [e.id]: ev.target.value })} />
                      <Button size="sm" variant="ghost" disabled={busy || !(reason[e.id] ?? "").trim()} onClick={() => call("/api/sync/outbox", { action: "withdraw", id: e.id, reason: reason[e.id] }, "Withdrawn")}>Withdraw</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
