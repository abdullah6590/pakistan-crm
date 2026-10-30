"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PackageOpen, Settings } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { formatCurrency } from "@/lib/utils";

interface Unit { code: string; factor: string }
interface Item {
  id: string; sku: string; name: string; category: string; screenCount: number; baseUnit: string; baseDecimals: number;
  units: Unit[]; purchaseUnit: string | null; unitsConfirmed: boolean; costHint: number | null;
}
interface Row { include: boolean; quantity: string; unit: string; loose: string; cost: string }

const selectClass = "flex h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";
const num = (t: string) => (t.trim() === "" ? NaN : Number(t));
const clean = (t: string) => t.replace(/[^\d.]/g, "");

/** Stock units of an entry: quantity × unit size + loose. */
function baseOf(item: Item, r: Row) {
  const factor = Number(item.units.find((u) => u.code === r.unit)?.factor ?? 1);
  const q = num(r.quantity);
  const loose = r.unit === item.baseUnit || r.loose.trim() === "" ? 0 : num(r.loose);
  return { factor, base: q * factor + loose };
}

export default function OpeningStockClient({ items, canPost, canEditUnits }: { items: Item[]; canPost: boolean; canEditUnits: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(items.map((it) => [it.id, { include: false, quantity: it.screenCount > 0 ? String(it.screenCount) : "", unit: it.purchaseUnit && it.screenCount === 0 ? it.purchaseUnit : it.baseUnit, loose: "", cost: "" }])),
  );
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const lines = useMemo(() => items.flatMap((it) => {
    const r = rows[it.id];
    if (!r?.include) return [];
    const { factor, base } = baseOf(it, r);
    const cost = num(r.cost);
    const problem = !(base > 0) ? "Enter the quantity on hand"
      : !(cost > 0) ? "Enter what one unit cost (unknown cost: leave the item out)"
      : r.unit !== it.baseUnit && num(r.loose || "0") >= factor ? `Loose ${it.baseUnit}s must be fewer than one ${r.unit}`
      : null;
    return [{ item: it, row: r, base, value: Math.round(base * (cost / factor) * 100) / 100, problem }];
  }), [items, rows]);
  const total = lines.reduce((t, l) => t + (l.problem ? 0 : l.value), 0);
  const problems = lines.filter((l) => l.problem);

  async function post() {
    if (!lines.length) { toast.error("Tick the items to enter"); return; }
    if (problems.length) { toast.error(`${problems[0].item.name}: ${problems[0].problem}`); return; }
    if (!checked) { toast.error("Tick that you have checked the quantities and costs"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/inventory/opening-stock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date, remarks: remarks || undefined, requestId, confirmed: true,
          lines: lines.map(({ item, row }) => ({
            componentId: item.id, quantity: row.quantity, unit: row.unit,
            loose: row.unit !== item.baseUnit && row.loose ? row.loose : undefined, unitCost: row.cost,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not enter the opening stock");
      toast.success(`Opening stock ${data.document.docNo} entered. A copy of the database was saved first: ${data.backup}`, { duration: 15000 });
      setRequestId(crypto.randomUUID());
      setChecked(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Opening stock"
        description="Stock already on hand, entered into Books once per item at what it cost. Items with an unknown cost stay out until the cost is known."
        icon={PackageOpen}
        actions={canEditUnits ? <Link href="/dashboard/accounting/settings" className={buttonVariants({ variant: "outline", size: "sm" })}><Settings className="mr-1 h-4 w-4" />Item units</Link> : undefined}
      />
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Items not yet in Books ({items.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Every active item&apos;s stock is already in Books. Corrections are made with a stock count.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Inventory shows</TableHead>
                    <TableHead className="w-24">Quantity</TableHead>
                    <TableHead className="w-28">Unit</TableHead>
                    <TableHead className="w-20">Loose</TableHead>
                    <TableHead className="w-32">Cost per unit (Rs)</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => {
                    const r = rows[it.id];
                    const line = lines.find((l) => l.item.id === it.id);
                    const isPack = r.unit !== it.baseUnit;
                    return (
                      <TableRow key={it.id} className={r.include ? "" : "opacity-70"}>
                        <TableCell><input type="checkbox" aria-label={`Enter ${it.name}`} checked={r.include} onChange={(e) => set(it.id, { include: e.target.checked })} /></TableCell>
                        <TableCell>
                          <div className="font-medium">{it.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.sku}{it.category ? ` · ${it.category}` : ""} · stock unit {it.baseUnit}
                            {it.units.filter((u) => u.code !== it.baseUnit).map((u) => ` · 1 ${u.code} = ${u.factor} ${it.baseUnit}`).join("")}
                          </div>
                          {!it.unitsConfirmed && <Badge variant="secondary" className="mt-1">units not confirmed</Badge>}
                          {it.costHint !== null && <div className="text-xs text-muted-foreground">Cost price on the item: {formatCurrency(it.costHint)} (check what it is per)</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{it.screenCount}</TableCell>
                        <TableCell><Input aria-label={`${it.name}: quantity`} inputMode="decimal" value={r.quantity} onChange={(e) => set(it.id, { quantity: clean(e.target.value) })} /></TableCell>
                        <TableCell>
                          <select aria-label={`${it.name}: unit`} className={selectClass} value={r.unit} onChange={(e) => set(it.id, { unit: e.target.value })}>
                            {it.units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                          </select>
                        </TableCell>
                        <TableCell><Input aria-label={`${it.name}: loose ${it.baseUnit}`} inputMode="decimal" disabled={!isPack} placeholder={isPack ? it.baseUnit : ""} value={isPack ? r.loose : ""} onChange={(e) => set(it.id, { loose: clean(e.target.value) })} /></TableCell>
                        <TableCell><Input aria-label={`${it.name}: cost per ${r.unit} in rupees`} inputMode="decimal" placeholder={`per ${r.unit}`} value={r.cost} onChange={(e) => set(it.id, { cost: clean(e.target.value) })} /></TableCell>
                        <TableCell className="text-right font-mono">
                          {line ? (line.problem ? <span role="alert" className="text-xs text-amber-700 dark:text-amber-400">{line.problem}</span> : <>{formatCurrency(line.value)}<div className="text-xs text-muted-foreground">{line.base} {it.baseUnit}</div></>) : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {items.length > 0 && (
        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1 md:col-span-2"><Label>Note</Label><Input value={remarks} placeholder="e.g. counted in the store on 26 October; costs from supplier bills" onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="md:col-span-3 space-y-2 text-sm">
              <div>{lines.length} item(s) ticked · total value <span className="font-semibold">{formatCurrency(total)}</span></div>
              <p className="text-muted-foreground">
                Each item is entered once. Its Inventory count becomes the quantity entered (the earlier count stays in its history).
                Stock goes in at cost with no sales income. A copy of the database is saved first. Later corrections are made with a stock count.
              </p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I have checked these quantities and costs</label>
              {canPost
                ? <Button disabled={busy || !lines.length} onClick={post}>{busy ? "Saving copy and entering..." : "Enter opening stock"}</Button>
                : <p className="text-amber-700 dark:text-amber-400">Only an administrator can enter opening stock.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
