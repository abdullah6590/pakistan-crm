"use client";

// Sale / purchase return against an original posted document. The server re-checks returnable quantities.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money, qty } from "@/lib/accounting/meta";

export interface ReturnSource {
  id: string;
  docNo: string;
  partyName: string | null;
  lines: { lineNo: number; description: string | null; unit: string | null; baseUnit: string; quantity: string; loose: string; unitPrice: string; baseQuantity: string; returnable: string }[];
}

const selectClass = "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export default function ReturnForm({ type, sources, cashBank, today }: { type: string; sources: ReturnSource[]; cashBank: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState("");
  const [date, setDate] = useState(today);
  const [refund, setRefund] = useState("");
  const [remarks, setRemarks] = useState("");
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const source = useMemo(() => sources.find((x) => x.id === sourceId), [sources, sourceId]);

  async function submit() {
    if (!source) return;
    setSaving(true);
    try {
      // Quantities are entered in the line's base unit, so any part of a pack can be returned
      const lines = source.lines.filter((l) => qtys[l.lineNo]).map((l) => ({ lineNo: l.lineNo, quantity: qtys[l.lineNo], unit: l.baseUnit }));
      const res = await fetch("/api/accounting/documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, date, originalDocumentId: source.id, refundAccountId: refund || undefined, lines, remarks: remarks || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast.success(`${data.document.docNo} posted`);
      router.push(`/dashboard/accounting/documents/${data.document.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1 md:col-span-2">
            <Label>Original {type === "SALE_RETURN" ? "sale" : "purchase invoice"}</Label>
            <select className={selectClass} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setQtys({}); }}>
              <option value="">Choose a document</option>
              {sources.map((x) => <option key={x.id} value={x.id}>{x.docNo}{x.partyName ? ` · ${x.partyName}` : ""}</option>)}
            </select>
          </div>
          {type === "SALE_RETURN" && (
            <div className="space-y-1 md:col-span-2">
              <Label>Refund</Label>
              <select className={selectClass} value={refund} onChange={(e) => setRefund(e.target.value)}>
                <option value="">Credit the customer&apos;s account</option>
                {cashBank.map((a) => <option key={a.id} value={a.id}>Pay back from {a.name}</option>)}
              </select>
            </div>
          )}
        </CardContent>
      </Card>
      {source && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lines on {source.docNo}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {source.lines.map((l) => (
              <div key={l.lineNo} className="grid items-end gap-2 md:grid-cols-6">
                <div className="md:col-span-2 text-sm">{l.lineNo}. {l.description}</div>
                <div className="text-sm text-muted-foreground">Sold/bought: {qty(l.baseQuantity)} {l.baseUnit}</div>
                <div className="text-sm text-muted-foreground">At {money(l.unitPrice)} per {l.unit}</div>
                <div className="text-sm">Can return: {qty(l.returnable)} {l.baseUnit}</div>
                <Input inputMode="decimal" placeholder={`Return (${l.baseUnit})`} value={qtys[l.lineNo] ?? ""} disabled={l.returnable === "0"} onChange={(e) => setQtys({ ...qtys, [l.lineNo]: e.target.value })} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card><CardContent className="p-4"><Label>Remarks</Label><Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></CardContent></Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>Back</Button>
        <Button onClick={submit} disabled={saving || !source || !Object.values(qtys).some(Boolean)}><Save className="mr-1 h-4 w-4" />Post return</Button>
      </div>
    </div>
  );
}
