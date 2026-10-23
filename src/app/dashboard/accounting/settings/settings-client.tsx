"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ItemUnitConfig } from "@/lib/domain/units";

interface AccountRow { id: string; code: string; name: string; kind: string; subType: string | null; isSystem: boolean }
interface ItemRow { id: string; sku: string; name: string; cfg: ItemUnitConfig; confirmed: boolean; hasProfile: boolean; referencePurchasePrice: string; referenceExpenses: string }

const selectClass = "flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";

const POLICY_OPTIONS: Record<string, { label: string; options?: [string, string][]; help: string }> = {
  NEGATIVE_STOCK_POLICY: { label: "Selling more than is in stock", options: [["ALLOW_WITH_WARNING", "Allow and warn"], ["ALLOW_SILENT", "Allow silently"], ["BLOCK", "Block"]], help: "Owner decision OD-04: allowed with a warning by default." },
  STOCK_ISSUE_APPROVAL: { label: "Stock issues and press losses", options: [["REQUIRED", "Administrator approval required"], ["NOT_REQUIRED", "Post immediately"]], help: "Owner instruction 4: approval required, no monetary threshold." },
  DATE_FORMAT: { label: "Date format on documents", options: [["DD/MM/YYYY", "DD/MM/YYYY"], ["MM/DD/YYYY", "MM/DD/YYYY"]], help: "" },
  BUSINESS_NAME: { label: "Business name (print header)", help: "" },
  BUSINESS_ADDRESS: { label: "Business address (print header)", help: "" },
  COUNTER_SALE_ACCOUNT: { label: "Unpaid cash-sale remainder account (code)", help: "F-03 default: COUNTER_SALE." },
  ISSUE_ACCOUNT_INTERNAL_CONSUMPTION: { label: "Account for internal consumption (code)", help: "" },
  ISSUE_ACCOUNT_DAMAGE: { label: "Account for damage (code)", help: "" },
  ISSUE_ACCOUNT_SAMPLE: { label: "Account for samples (code)", help: "" },
  ISSUE_ACCOUNT_OTHER: { label: "Account for other issues (code)", help: "" },
  PRESS_LOSS_ACCOUNT: { label: "Account for press waste and differences (code)", help: "" },
  CHARGE_EXPENSE_FREIGHT: { label: "Default expense account: freight (code)", help: "Used only when a recorded charge is explicitly posted as an expense." },
  CHARGE_EXPENSE_LOADING: { label: "Default expense account: loading (code)", help: "" },
  CHARGE_EXPENSE_BILTY: { label: "Default expense account: bilty (code)", help: "" },
  CHARGE_EXPENSE_OTHER_PURCHASE: { label: "Default expense account: other purchase charges (code)", help: "" },
  CHARGE_EXPENSE_PRINTING: { label: "Default expense account: printing charges (code)", help: "" },
};

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not save");
  return data;
}

export default function SettingsClient(props: { settings: Record<string, string>; admins: { id: string; label: string }[]; canEditSettings: boolean; canAccounts: boolean; canUnits: boolean; accounts: AccountRow[]; items: ItemRow[] }) {
  const router = useRouter();
  const [values, setValues] = useState(props.settings);
  const [account, setAccount] = useState({ name: "", kind: "PARTY", subType: "CUSTOMER", phone: "" });
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {Object.keys(values).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Policies</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {Object.entries(POLICY_OPTIONS).map(([key, p]) => (
              <div key={key} className="space-y-1">
                <Label>{p.label}</Label>
                {p.options ? (
                  <select className={selectClass} value={values[key] ?? ""} disabled={!props.canEditSettings} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
                    {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <Input value={values[key] ?? ""} disabled={!props.canEditSettings} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
                )}
                {p.help && <p className="text-xs text-muted-foreground">{p.help}</p>}
              </div>
            ))}
            <div className="space-y-1 md:col-span-2">
              <Label>Owner who may approve their own stock issues</Label>
              <select className={selectClass} value={values.SELF_APPROVAL_OVERRIDE_USER ?? ""} disabled={!props.canEditSettings} onChange={(e) => setValues({ ...values, SELF_APPROVAL_OVERRIDE_USER: e.target.value })}>
                <option value="">Nobody (separation of duties for everyone)</option>
                {props.admins.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Leave as &quot;Nobody&quot; until the owner account is verified. Another administrator must make this choice, and every self-approval needs a written reason.</p>
            </div>
            {props.canEditSettings && (
              <div className="md:col-span-2">
                <Button disabled={busy} onClick={() => run(() => send("/api/accounting/settings", "PUT", values), "Settings saved")}><Save className="mr-1 h-4 w-4" />Save policies</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Accounts</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {props.canAccounts && (
            <div className="grid gap-2 md:grid-cols-5">
              <Input placeholder="Account name" value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
              <select className={selectClass} value={account.kind} onChange={(e) => setAccount({ ...account, kind: e.target.value, subType: e.target.value === "PARTY" ? "CUSTOMER" : e.target.value === "CASH_BANK" ? "CASH" : "EXPENSE" })}>
                <option value="PARTY">Party</option><option value="CASH_BANK">Cash / bank</option><option value="GL">General ledger</option>
              </select>
              <select className={selectClass} value={account.subType} onChange={(e) => setAccount({ ...account, subType: e.target.value })}>
                {(account.kind === "PARTY" ? ["CUSTOMER", "SUPPLIER", "PRESS", "OTHER"] : account.kind === "CASH_BANK" ? ["CASH", "BANK"] : ["EXPENSE", "INCOME", "ASSET", "LIABILITY", "EQUITY"]).map((x) => <option key={x} value={x}>{x.toLowerCase()}</option>)}
              </select>
              <Input placeholder="Phone (optional)" value={account.phone} onChange={(e) => setAccount({ ...account, phone: e.target.value })} />
              <Button disabled={busy || !account.name.trim()} onClick={() => run(async () => { await send("/api/accounting/accounts", "POST", { ...account, phone: account.phone || undefined }); setAccount({ ...account, name: "", phone: "" }); }, "Account created")}>
                <Plus className="mr-1 h-4 w-4" />Add account
              </Button>
            </div>
          )}
          <div className="grid gap-1 text-sm md:grid-cols-2">
            {props.accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 border-b py-1">
                <span className="w-24 font-mono text-xs">{a.code}</span>
                <span className="flex-1">{a.name}</span>
                <Badge variant="outline">{(a.subType ?? a.kind).toLowerCase()}</Badge>
                {a.isSystem && <Badge variant="secondary">system</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {props.canUnits && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Item units and pack sizes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Each item has a stock unit and optional larger units (e.g. 1 carton = 2000 pieces). Items marked
              &quot;unconfirmed&quot; use units derived from the old item fields until you confirm them (Report 13 D-C).
            </p>
            {editing && <UnitEditor item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
            <div className="grid gap-1 text-sm">
              {props.items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 border-b py-1">
                  <span className="w-28 font-mono text-xs">{it.sku}</span>
                  <span className="flex-1">{it.name}</span>
                  <span className="text-muted-foreground">
                    {it.cfg.baseUnit}{(it.cfg.conversions ?? []).map((c) => ` · 1 ${c.code} = ${c.factor}`).join("")}
                  </span>
                  <Badge variant={it.confirmed ? "default" : "secondary"}>{it.confirmed ? "confirmed" : "unconfirmed"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setEditing(it)}>Edit</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UnitEditor({ item, onClose, onSaved }: { item: ItemRow; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(item.cfg.kind);
  const [baseUnit, setBaseUnit] = useState(item.cfg.baseUnit);
  const [baseDecimals, setBaseDecimals] = useState(item.cfg.baseDecimals ?? 0);
  const [conversions, setConversions] = useState((item.cfg.conversions ?? []).map((c) => ({ code: c.code, factor: String(c.factor) })));
  const [purchaseUnit, setPurchaseUnit] = useState(item.cfg.purchaseUnit ?? "");
  const [saleUnit, setSaleUnit] = useState(item.cfg.saleUnit ?? "");
  const [confirmed, setConfirmed] = useState(item.confirmed);
  const [refPrice, setRefPrice] = useState(item.referencePurchasePrice);
  const [refExp, setRefExp] = useState(item.referenceExpenses);
  const [busy, setBusy] = useState(false);
  const units = [...conversions.map((c) => c.code).filter(Boolean), baseUnit];

  async function save() {
    setBusy(true);
    try {
      await send(`/api/accounting/items/${item.id}/units`, "PUT", {
        kind, baseUnit, baseDecimals, confirmed,
        conversions: conversions.filter((c) => c.code && c.factor).map((c) => ({ code: c.code, factor: c.factor })),
        purchaseUnit: purchaseUnit || null, saleUnit: saleUnit || null,
        referencePurchasePrice: refPrice || null, referenceExpenses: refExp || null,
      });
      toast.success("Units saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="font-medium">{item.sku} · {item.name}</div>
      <div className="grid gap-2 md:grid-cols-4">
        <div className="space-y-1"><Label>Kind</Label>
          <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as ItemUnitConfig["kind"])}>
            {["PAPER", "PIECE", "WEIGHT", "ROLL", "SERVICE"].map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label>Stock unit</Label><Input value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} /></div>
        <div className="space-y-1"><Label>Decimals allowed</Label><Input type="number" min={0} max={3} value={baseDecimals} onChange={(e) => setBaseDecimals(Number(e.target.value))} /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Units confirmed by owner</label>
      </div>
      <div className="space-y-2">
        <Label>Larger units</Label>
        {conversions.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm">1</span>
            <Input className="max-w-[10rem]" placeholder="carton" value={c.code} onChange={(e) => setConversions(conversions.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
            <span className="text-sm">=</span>
            <Input className="max-w-[8rem]" inputMode="decimal" value={c.factor} onChange={(e) => setConversions(conversions.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} />
            <span className="text-sm">{baseUnit}</span>
            <Button size="sm" variant="ghost" onClick={() => setConversions(conversions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setConversions([...conversions, { code: "", factor: "" }])}><Plus className="mr-1 h-4 w-4" />Add unit</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <div className="space-y-1"><Label>Buy in</Label><select className={selectClass} value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}><option value="">(stock unit)</option>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
        <div className="space-y-1"><Label>Sell in</Label><select className={selectClass} value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)}><option value="">(stock unit)</option>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
        <div className="space-y-1"><Label>{kind === "PAPER" ? "Reference rate per kg" : "Reference purchase price (per buy unit)"}</Label><Input inputMode="decimal" value={refPrice} onChange={(e) => setRefPrice(e.target.value)} /></div>
        <div className="space-y-1"><Label>{kind === "PAPER" ? "Expenses per kg" : "Expenses (per buy unit)"}</Label><Input inputMode="decimal" value={refExp} onChange={(e) => setRefExp(e.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">The reference price is used only to estimate cost when no purchase has been recorded; such costs are marked &quot;estimated&quot;.</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}><Save className="mr-1 h-4 w-4" />Save units</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
