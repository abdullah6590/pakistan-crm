"use client";

// Entry form for every accounting document. Line amounts are previewed with the same domain functions the
// server uses (src/lib/domain), so the screen and the posted document agree; the server re-validates all input.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_TYPES, REASON_LABEL, money } from "@/lib/accounting/meta";
import { ItemUnitConfig, unitFactor } from "@/lib/domain/units";
import { priceLine, packetPriceFromRate, weightPerPacket } from "@/lib/domain/pricing";
import { documentTotal } from "@/lib/domain/rounding";
import { Dec, toPlain, toFixed } from "@/lib/domain/decimal";

interface ItemOption {
  id: string;
  name: string;
  sku: string;
  cfg: ItemUnitConfig;
  confirmed: boolean;
  dims: { x: number | null; y: number | null; gsm: number | null; divisor: number | null };
}
interface AccountOption { id: string; code: string; name: string; kind: string; subType: string | null }

interface Line {
  componentId: string;
  unit: string;
  quantity: string;
  loose: string;
  unitPrice: string;
  ratePerKg: string;
  consumedComponentId: string;
  consumedUnit: string;
  consumedQuantity: string;
  consumedLoose: string;
}

interface ChargeLine { kind: string; amount: string; description: string; reference: string }

const CHARGE_KINDS_FOR: Record<string, [string, string][]> = {
  PURCHASE_INVOICE: [["FREIGHT", "Freight"], ["LOADING", "Loading / unloading"], ["BILTY", "Bilty"], ["OTHER_PURCHASE", "Other purchase charge"]],
  PRESS_RECEIPT: [["PRINTING", "Printing charge"]],
};

const EMPTY_LINE: Line = { componentId: "", unit: "", quantity: "", loose: "", unitPrice: "", ratePerKg: "", consumedComponentId: "", consumedUnit: "", consumedQuantity: "", consumedLoose: "" };

const selectClass = "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function unitsOf(item?: ItemOption): string[] {
  if (!item) return [];
  return [...(item.cfg.conversions ?? []).map((c) => c.code), item.cfg.baseUnit];
}

function defaultUnit(item: ItemOption, type: string): string {
  const preferred = type === "PURCHASE_INVOICE" ? item.cfg.purchaseUnit : item.cfg.saleUnit;
  return preferred ?? item.cfg.conversions?.[0]?.code ?? item.cfg.baseUnit;
}

function preview(item: ItemOption | undefined, l: Line, priced: boolean): { amount: Dec | null; base: string; error?: string } {
  if (!item || !l.quantity) return { amount: null, base: "" };
  try {
    const p = priceLine({ unit: item.cfg, quantity: { quantity: l.quantity, unit: l.unit || undefined, loose: l.loose || undefined }, unitPrice: priced ? l.unitPrice || "0" : "0" });
    return { amount: priced ? p.amount : null, base: `${toPlain(p.baseQuantity)} ${item.cfg.baseUnit}` };
  } catch (e) {
    return { amount: null, base: "", error: (e as Error).message };
  }
}

export default function DocumentForm({ type, items, accounts, today }: { type: string; items: ItemOption[]; accounts: AccountOption[]; today: string }) {
  const meta = DOCUMENT_TYPES[type];
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(today);
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const chargeKinds = CHARGE_KINDS_FOR[type];
  const [charges, setCharges] = useState<ChargeLine[]>([]);
  const chargePayload = () =>
    charges.filter((c) => c.amount).map((c) => ({ kind: c.kind, amount: c.amount, description: c.description, reference: c.reference || undefined }));
  const [f, setF] = useState<Record<string, string>>({ series: "CRV", reason: type === "PRESS_LOSS" ? "WASTE" : "INTERNAL_CONSUMPTION" });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const parties = accounts.filter((a) => a.kind === "PARTY");
  const cashBank = accounts.filter((a) => a.kind === "CASH_BANK");
  const nonCash = accounts.filter((a) => a.kind !== "CASH_BANK");
  const label = (a: AccountOption) => `${a.code} · ${a.name}${a.subType ? ` (${a.subType.toLowerCase()})` : ""}`;

  const priced = !!meta.priced;
  const previews = lines.map((l) => preview(itemById.get(l.componentId), l, priced));
  const amounts = previews.map((p) => p.amount).filter((a): a is Dec => a !== null);
  const total = priced && amounts.length ? documentTotal(amounts, type === "PURCHASE_INVOICE" ? "PAISA_HALF_EVEN" : "RUPEE_HALF_EVEN") : null;

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const next = { ...l, ...patch };
      if (patch.componentId !== undefined) {
        const item = itemById.get(patch.componentId);
        next.unit = item ? defaultUnit(item, type) : "";
        next.ratePerKg = "";
      }
      if (patch.consumedComponentId !== undefined) {
        const item = itemById.get(patch.consumedComponentId);
        next.consumedUnit = item ? item.cfg.baseUnit : "";
      }
      // Paper: price per packet from rate per kg and the packet's real weight (OD-02)
      const item = itemById.get(next.componentId);
      if ((patch.ratePerKg !== undefined || patch.unit !== undefined) && item?.cfg.kind === "PAPER" && next.ratePerKg && next.unit !== item.cfg.baseUnit) {
        try {
          const d = item.dims;
          const w = weightPerPacket({ x: d.x ?? 0, y: d.y ?? 0, gsm: d.gsm ?? 0, divisor: d.divisor ?? undefined }, Number(toPlain(unitFactor(item.cfg, next.unit))));
          next.unitPrice = toFixed(packetPriceFromRate(next.ratePerKg, w), 2);
        } catch {
          /* leave the typed price */
        }
      }
      return next;
    }));
  }

  // BR-10 last-price memory: pre-fill an empty price from the item's last posted purchase or sale
  async function prefillPrice(i: number, componentId: string) {
    if (!priced || !componentId || (type !== "PURCHASE_INVOICE" && type !== "SALE_INVOICE" && type !== "CASH_SALE")) return;
    try {
      const res = await fetch(`/api/accounting/items/${componentId}/last-price`);
      if (!res.ok) return;
      const data = await res.json();
      const last = type === "PURCHASE_INVOICE" ? data.purchase : data.sale;
      if (!last) return;
      setLines((ls) => ls.map((l, j) => (j === i && l.componentId === componentId && !l.unitPrice && l.unit === last.unit ? { ...l, unitPrice: last.unitPrice } : l)));
    } catch {
      /* no default price */
    }
  }

  function linePayload(l: Line) {
    const base = { componentId: l.componentId, quantity: l.quantity, unit: l.unit || undefined, loose: l.loose || undefined };
    if (priced) return { ...base, unitPrice: l.unitPrice };
    if (type === "PRESS_RECEIPT") {
      return { ...base, consumedComponentId: l.consumedComponentId, consumedQuantity: l.consumedQuantity, consumedUnit: l.consumedUnit || undefined, consumedLoose: l.consumedLoose || undefined };
    }
    return base;
  }

  function payload(): Record<string, unknown> {
    const common = { type, date, remarks: remarks || undefined };
    const itemLines = lines.filter((l) => l.componentId).map(linePayload);
    switch (type) {
      case "SALE_INVOICE": return { ...common, partyAccountId: f.party, lines: itemLines };
      case "PURCHASE_INVOICE": return { ...common, partyAccountId: f.party, lines: itemLines, charges: chargePayload(), vendorBillNo: f.vendorBillNo || undefined, vendorBillDate: f.vendorBillDate || null, biltyNo: f.biltyNo || undefined, biltyDate: f.biltyDate || null };
      case "CASH_SALE": return { ...common, cashAccountId: f.cash, amountReceived: f.amountReceived || undefined, partyAccountId: f.party || undefined, customerName: f.customerName || undefined, lines: itemLines };
      case "STOCK_ISSUE": return { ...common, reason: f.reason, counterAccountId: f.counter || undefined, lines: itemLines, remarks };
      case "STOCK_ADJUSTMENT": return { ...common, lines: itemLines, remarks };
      case "PRESS_LOSS": return { ...common, pressAccountId: f.party, reason: f.reason, lines: itemLines, remarks };
      case "PRESS_RECEIPT": return { ...common, pressAccountId: f.party, lines: itemLines, charges: chargePayload() };
      case "PRESS_DISPATCH": case "PRESS_RETURN": return { ...common, pressAccountId: f.party, lines: itemLines };
      case "VOUCHER": return { ...common, series: f.series, debitAccountId: f.debit, creditAccountId: f.credit, amount: f.amount };
      case "TRANSFER": return { ...common, fromAccountId: f.from, toAccountId: f.to, amount: f.amount };
      default: return { ...common, accountId: f.account, debit: f.side === "CREDIT" ? undefined : f.amount, credit: f.side === "CREDIT" ? f.amount : undefined };
    }
  }

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      if (data.pending) {
        // Desktop working from its local copy: saved here, sent to the main server automatically
        toast.success(`Saved on this computer as ${data.entry.provisionalRef} — Pending Sync`);
        router.push("/dashboard/accounting/sync");
        return;
      }
      toast.success(data.document.status === "PENDING_APPROVAL" ? `${data.document.docNo} sent for approval` : `${data.document.docNo} posted`);
      router.push(`/dashboard/accounting/documents/${data.document.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  const accountSelect = (key: string, options: AccountOption[], placeholder: string) => (
    <select className={selectClass} value={f[key] ?? ""} onChange={(e) => set(key, e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {(type === "SALE_INVOICE" || type === "PURCHASE_INVOICE") && (
            <div className="space-y-1 md:col-span-2">
              <Label>{type === "SALE_INVOICE" ? "Customer" : "Supplier"}</Label>
              {accountSelect("party", parties, "Choose an account")}
            </div>
          )}
          {meta.party === "press" && (
            <div className="space-y-1 md:col-span-2">
              <Label>Printing press</Label>
              {accountSelect("party", parties.filter((a) => a.subType === "PRESS" || !a.subType || a.subType === "SUPPLIER"), "Choose the press")}
            </div>
          )}
          {type === "CASH_SALE" && (<>
            <div className="space-y-1">
              <Label>Received into</Label>
              {accountSelect("cash", cashBank, "Cash or bank account")}
            </div>
            <div className="space-y-1">
              <Label>Customer name (optional)</Label>
              <Input value={f.customerName ?? ""} onChange={(e) => set("customerName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Amount received</Label>
              <Input inputMode="decimal" placeholder={total ? `Full amount ${money(toPlain(total.total), 0)}` : "Full amount"} value={f.amountReceived ?? ""} onChange={(e) => set("amountReceived", e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Unpaid remainder charged to</Label>
              {accountSelect("party", parties, "Counter Sale (default)")}
            </div>
          </>)}
          {type === "PURCHASE_INVOICE" && (<>
            <div className="space-y-1"><Label>Supplier bill no</Label><Input value={f.vendorBillNo ?? ""} onChange={(e) => set("vendorBillNo", e.target.value)} /></div>
            <div className="space-y-1"><Label>Supplier bill date</Label><Input type="date" value={f.vendorBillDate ?? ""} onChange={(e) => set("vendorBillDate", e.target.value)} /></div>
            <div className="space-y-1"><Label>Bilty no</Label><Input value={f.biltyNo ?? ""} onChange={(e) => set("biltyNo", e.target.value)} /></div>
            <div className="space-y-1"><Label>Bilty date</Label><Input type="date" value={f.biltyDate ?? ""} onChange={(e) => set("biltyDate", e.target.value)} /></div>
          </>)}
          {(type === "STOCK_ISSUE" || type === "PRESS_LOSS") && (
            <div className="space-y-1">
              <Label>Reason</Label>
              <select className={selectClass} value={f.reason} onChange={(e) => set("reason", e.target.value)}>
                {(type === "STOCK_ISSUE" ? ["INTERNAL_CONSUMPTION", "DAMAGE", "SAMPLE", "OTHER"] : ["WASTE", "DAMAGE", "UNEXPLAINED_DIFFERENCE"]).map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
              </select>
            </div>
          )}
          {type === "STOCK_ISSUE" && (
            <div className="space-y-1">
              <Label>Charge cost to (optional)</Label>
              {accountSelect("counter", nonCash, "Default account for the reason")}
            </div>
          )}

          {type === "VOUCHER" && (<>
            <div className="space-y-1">
              <Label>Voucher type</Label>
              <select className={selectClass} value={f.series} onChange={(e) => set("series", e.target.value)}>
                <option value="CRV">CRV · Cash receipt</option>
                <option value="BRV">BRV · Bank receipt</option>
                <option value="CPV">CPV · Cash payment</option>
                <option value="BPV">BPV · Bank payment</option>
                <option value="JV">JV · Journal</option>
              </select>
            </div>
            <div className="space-y-1"><Label>Debit account</Label>{accountSelect("debit", accounts, "Choose")}</div>
            <div className="space-y-1"><Label>Credit account</Label>{accountSelect("credit", accounts, "Choose")}</div>
            <div className="space-y-1"><Label>Amount</Label><Input inputMode="decimal" value={f.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></div>
          </>)}
          {type === "TRANSFER" && (<>
            <div className="space-y-1"><Label>From</Label>{accountSelect("from", cashBank, "Cash or bank")}</div>
            <div className="space-y-1"><Label>To</Label>{accountSelect("to", cashBank, "Cash or bank")}</div>
            <div className="space-y-1"><Label>Amount</Label><Input inputMode="decimal" value={f.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></div>
          </>)}
          {type === "OPENING_BALANCE" && (<>
            <div className="space-y-1 md:col-span-2"><Label>Account</Label>{accountSelect("account", accounts.filter((a) => a.code !== "OPENING_BALANCE_EQUITY"), "Choose")}</div>
            <div className="space-y-1">
              <Label>Side</Label>
              <select className={selectClass} value={f.side ?? "DEBIT"} onChange={(e) => set("side", e.target.value)}>
                <option value="DEBIT">Debit (owed to us / asset)</option>
                <option value="CREDIT">Credit (we owe / liability)</option>
              </select>
            </div>
            <div className="space-y-1"><Label>Amount</Label><Input inputMode="decimal" value={f.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></div>
          </>)}
        </CardContent>
      </Card>

      {meta.form === "items" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lines</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {lines.map((l, i) => {
              const item = itemById.get(l.componentId);
              const consumed = itemById.get(l.consumedComponentId);
              const p = previews[i];
              return (
                <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-12">
                  <div className="space-y-1 md:col-span-4">
                    <Label>{type === "PRESS_RECEIPT" ? "Printed item received" : "Item"}</Label>
                    <select className={selectClass} value={l.componentId} onChange={(e) => { updateLine(i, { componentId: e.target.value }); void prefillPrice(i, e.target.value); }}>
                      <option value="">Choose an item</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}{it.confirmed ? "" : " (units unconfirmed)"}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Unit</Label>
                    <select className={selectClass} value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value, loose: "" })} disabled={!item}>
                      {unitsOf(item).map((u) => <option key={u} value={u}>{u}{u !== item?.cfg.baseUnit ? ` (${toPlain(unitFactor(item!.cfg, u))} ${item!.cfg.baseUnit})` : ""}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>{type === "STOCK_ADJUSTMENT" ? "Counted quantity" : "Quantity"}</Label>
                    <Input inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Loose {item?.cfg.baseUnit ?? ""}</Label>
                    <Input inputMode="decimal" value={l.loose} disabled={!item || l.unit === item.cfg.baseUnit} onChange={(e) => updateLine(i, { loose: e.target.value })} />
                  </div>
                  {priced && (
                    <div className="space-y-1 md:col-span-2">
                      <Label>Price per {l.unit || "unit"}</Label>
                      <Input inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                    </div>
                  )}
                  {priced && item?.cfg.kind === "PAPER" && l.unit !== item.cfg.baseUnit && (
                    <div className="space-y-1 md:col-span-2">
                      <Label>Rate per kg (optional)</Label>
                      <Input inputMode="decimal" value={l.ratePerKg} onChange={(e) => updateLine(i, { ratePerKg: e.target.value })} />
                    </div>
                  )}
                  {type === "PRESS_RECEIPT" && (<>
                    <div className="space-y-1 md:col-span-4">
                      <Label>Material used (held at press)</Label>
                      <select className={selectClass} value={l.consumedComponentId} onChange={(e) => updateLine(i, { consumedComponentId: e.target.value })}>
                        <option value="">Choose material</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>Unit</Label>
                      <select className={selectClass} value={l.consumedUnit} onChange={(e) => updateLine(i, { consumedUnit: e.target.value, consumedLoose: "" })} disabled={!consumed}>
                        {unitsOf(consumed).map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2"><Label>Quantity used</Label><Input inputMode="decimal" value={l.consumedQuantity} onChange={(e) => updateLine(i, { consumedQuantity: e.target.value })} /></div>
                    <div className="space-y-1 md:col-span-2"><Label>Loose used</Label><Input inputMode="decimal" value={l.consumedLoose} disabled={!consumed || l.consumedUnit === consumed.cfg.baseUnit} onChange={(e) => updateLine(i, { consumedLoose: e.target.value })} /></div>
                  </>)}
                  <div className="flex items-end justify-between gap-2 md:col-span-12">
                    <span className={`text-sm ${p.error ? "text-destructive" : "text-muted-foreground"}`}>
                      {p.error ?? (p.base ? `= ${p.base}${p.amount !== null ? ` · amount ${money(toPlain(p.amount))}` : ""}` : "")}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}><Plus className="mr-1 h-4 w-4" />Add line</Button>
          </CardContent>
        </Card>
      )}

      {chargeKinds && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Charges</CardTitle>
            <p className="text-sm text-muted-foreground">
              Record only — not posted to accounts. These charges do not change item cost, stock value, the
              {type === "PURCHASE_INVOICE" ? " supplier's" : " press's"} balance, expenses, cash or bank. To recognise one as an
              expense later, use &quot;Post as expense&quot; on the Charges screen.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {charges.map((c, i) => (
              <div key={i} className="grid gap-2 md:grid-cols-12">
                <select className={`${selectClass} md:col-span-3`} value={c.kind} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                  {chargeKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <Input className="md:col-span-2" inputMode="decimal" placeholder="Amount" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Input className="md:col-span-4" placeholder="Description" value={c.description} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input className="md:col-span-2" placeholder="Reference (bilty no, job)" value={c.reference} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setCharges(charges.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setCharges([...charges, { kind: chargeKinds[0][0], amount: "", description: "", reference: "" }])}>
              <Plus className="mr-1 h-4 w-4" />Record a charge
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1 md:col-span-2">
            <Label>{type === "STOCK_ISSUE" || type === "PRESS_LOSS" ? "Explanation (required)" : "Remarks"}</Label>
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          {total && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Sub-total</span><span>{money(toPlain(total.exact))}</span></div>
              {total.roundingAdjustment !== BigInt(0) && <div className="flex justify-between text-muted-foreground"><span>Rounding</span><span>{money(toPlain(total.roundingAdjustment))}</span></div>}
              <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{money(toPlain(total.total), type === "PURCHASE_INVOICE" ? 2 : 0)}</span></div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>Back</Button>
        <Button onClick={submit} disabled={saving}><Save className="mr-1 h-4 w-4" />{meta.approval ? "Submit for approval" : "Post"}</Button>
      </div>
    </div>
  );
}
