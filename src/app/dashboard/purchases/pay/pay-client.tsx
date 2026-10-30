"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Wallet, Undo2, CornerDownRight, FileText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatPaisa } from "@/lib/utils";

interface SupplierOption { id: string; name: string; phone: string; isActive: boolean }
interface AccountOption { id: string; name: string; subType: string | null; code: string }
interface MethodOption { value: string; label: string; subType: string }
interface OpenBill { id: string; docNo: string; type: string; vendorBillNo: string | null; date: string; dueDate: string | null; total: string; paid: string; remaining: string }
interface Credit { sourceId: string; docNo: string; kind: string; date: string; total: string; unapplied: string }
interface Account { supplier: { id: string; name: string; isActive: boolean }; partyAccountId: string | null; partyCode: string | null; balance: string; payable: string; bills: OpenBill[]; credit: Credit[] }

const rs = (v: string | number) => formatPaisa(v);
const today = () => new Date().toISOString().slice(0, 10);
const clean = (t: string) => {
  const [w, ...rest] = t.replace(/[^\d.]/g, "").split(".");
  const whole = w.replace(/^0+(?=\d)/, "");
  return rest.length ? `${whole || "0"}.${rest.join("").slice(0, 2)}` : whole;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PaySupplierClient({ suppliers, accounts, methods, initialSupplierId, focusBillId }: {
  suppliers: SupplierOption[]; accounts: AccountOption[]; methods: MethodOption[]; initialSupplierId: string | null; focusBillId: string | null;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [cashAccountId, setCashAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [applyFor, setApplyFor] = useState<{ sourceId: string; billId: string; amount: string } | null>(null);
  const [refund, setRefund] = useState({ amount: "", method: "CASH", reference: "" });

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/purchases/payments?supplierId=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load the supplier");
    return data.account as Account;
  }, []);

  useEffect(() => {
    if (!supplierId) return;
    let stale = false;
    load(supplierId).then((a) => {
      if (stale) return;
      setAccount(a);
      // Opened from a bill: that bill is chosen with what it still owes
      const bill = focusBillId ? a.bills.find((b) => b.id === focusBillId) : undefined;
      if (bill) { setAlloc({ [bill.id]: bill.remaining }); setAmount(bill.remaining); }
    }, (e) => { if (!stale) toast.error((e as Error).message); });
    return () => { stale = true; };
  }, [supplierId, focusBillId, load]);

  const methodAccounts = useMemo(() => accounts.filter((a) => a.subType === methods.find((x) => x.value === method)?.subType), [accounts, methods, method]);
  const allocated = round2(Object.values(alloc).reduce((t, v) => t + (parseFloat(v) || 0), 0));
  const paying = parseFloat(amount) || 0;
  const leftOver = round2(paying - allocated);
  const shown = account && account.supplier.id === supplierId ? account : null;
  const matches = query.trim() ? suppliers.filter((s) => `${s.name} ${s.phone}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];
  const overAllocated = shown ? shown.bills.filter((b) => (parseFloat(alloc[b.id] ?? "") || 0) > Number(b.remaining)) : [];

  const refresh = async () => { if (supplierId) setAccount(await load(supplierId)); router.refresh(); };

  const fillBill = (b: OpenBill) => {
    const others = allocated - (parseFloat(alloc[b.id] ?? "") || 0);
    const room = paying > 0 ? Math.max(0, round2(paying - others)) : Number(b.remaining);
    setAlloc({ ...alloc, [b.id]: String(Math.min(Number(b.remaining), room)) });
    if (paying === 0) setAmount(String(round2(others + Number(b.remaining))));
  };

  const submit = async () => {
    if (!shown) return;
    if (paying <= 0) { toast.error("Enter the amount paid"); return; }
    if (overAllocated.length) { toast.error(`${overAllocated[0].docNo}: more than it still owes`); return; }
    if (leftOver < 0) { toast.error("The amounts for bills add up to more than the amount paid"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/purchases/payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId, date, amount, method, cashAccountId: cashAccountId || undefined, reference: reference.trim() || undefined, remarks: remarks.trim() || undefined, requestId,
          allocations: Object.entries(alloc).filter(([, v]) => (parseFloat(v) || 0) > 0).map(([billId, v]) => ({ billId, amount: v })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the payment");
      if (data.pending) {
        toast.success(`Saved on this computer as ${data.entry.provisionalRef ?? "a pending entry"}; it gets its number when it syncs with the main server`, { duration: 10000 });
        setAmount(""); setAlloc({}); setReference(""); setRemarks(""); setRequestId(crypto.randomUUID());
        return;
      }
      toast.success(`Payment ${data.payment.docNo} saved${leftOver > 0 ? `; ${rs(leftOver)} kept as an advance with the supplier` : ""}`, {
        duration: 10000, action: { label: "Voucher PDF", onClick: () => window.open(`/api/purchases/payments/${data.payment.id}/pdf?inline=1`, "_blank") },
      });
      setAmount(""); setAlloc({}); setReference(""); setRemarks(""); setRequestId(crypto.randomUUID());
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const applyCredit = async () => {
    if (!applyFor) return;
    setSaving(true);
    try {
      const res = await fetch("/api/purchases/payments/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...applyFor, requestId: crypto.randomUUID() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not use the credit");
      toast.success("Credit used for the bill");
      setApplyFor(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doRefund = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/purchases/payments/refund", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, date, amount: refund.amount, method: refund.method, reference: refund.reference.trim() || undefined, requestId: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the refund");
      toast.success(`Refund ${data.refund.docNo} received from the supplier`);
      setRefund({ amount: "", method: "CASH", reference: "" });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const totalCredit = shown?.credit.reduce((t, c) => t + Number(c.unapplied), 0) ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to Purchases" onClick={() => router.push("/dashboard/purchases")}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pay supplier</h1>
          <p className="text-sm text-muted-foreground">Money paid to a supplier, and the bills it settles. Nothing is put against a bill unless you enter it.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Supplier</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {shown ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <p className="font-medium">{shown.supplier.name} <span className="font-mono text-xs text-muted-foreground">{shown.partyCode}</span> {!shown.supplier.isActive && <Badge variant="secondary">archived</Badge>}</p>
                <p className="text-xs text-muted-foreground">
                  {Number(shown.balance) >= 0 ? `You owe ${rs(shown.balance)}` : `The supplier owes you ${rs(-Number(shown.balance))}`} · bills still payable {rs(shown.payable)}
                </p>
              </div>
              <div className="flex gap-2">
                <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/suppliers/${supplierId}/statement?format=pdf&inline=1`} target="_blank" rel="noreferrer"><FileText className="mr-1 h-4 w-4" aria-hidden />Statement</a>
                <Button variant="ghost" size="sm" onClick={() => { setSupplierId(""); setAccount(null); setAlloc({}); }}>Change</Button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <Input aria-label="Search supplier" placeholder="Search supplier by name or phone..." value={query} onChange={(e) => setQuery(e.target.value)} />
              {matches.length > 0 && (
                <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background shadow-lg">
                  {matches.map((s) => (
                    <button key={s.id} type="button" className="w-full px-3 py-2 text-left hover:bg-muted text-sm" onClick={() => { setSupplierId(s.id); setQuery(""); setAlloc({}); }}>
                      <span className="font-medium">{s.name}</span> {s.phone && <span className="text-muted-foreground">{s.phone}</span>} {!s.isActive && <span className="text-xs text-muted-foreground">(archived)</span>}
                    </button>
                  ))}
                </div>
              )}
              {supplierId && !shown && <p className="text-xs text-muted-foreground mt-1">Loading...</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {shown && (<>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" aria-hidden /> Payment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label htmlFor="pay-date">Payment date</Label><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="pay-amount">Amount paid (Rs)</Label><Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(clean(e.target.value))} onFocus={(e) => e.target.select()} /></div>
              <div className="space-y-1">
                <Label>Method</Label>
                <Select value={method} onChange={(v: string) => { setMethod(v); setCashAccountId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>From account</Label>
                <Select value={cashAccountId || "default"} onChange={(v: string) => setCashAccountId(v === "default" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default for {methods.find((m) => m.value === method)?.label}</SelectItem>
                    {methodAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label htmlFor="pay-ref">Bank / cheque reference</Label><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TT-5531, cheque 004512" /></div>
              <div className="space-y-1"><Label htmlFor="pay-remarks">Remarks</Label><Input id="pay-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional" /></div>
            </div>
            <p className="text-xs text-muted-foreground">The voucher number (CPV for cash, BPV for bank) is given when the payment is saved.</p>

            <div>
              <Label>Bills this payment settles</Label>
              {shown.bills.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No unpaid bills. The whole amount will be kept as an advance with the supplier.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Supplier bill</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Still payable</TableHead><TableHead className="w-[170px]">Pay now</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {shown.bills.map((b) => {
                      const over = (parseFloat(alloc[b.id] ?? "") || 0) > Number(b.remaining);
                      const overdue = b.dueDate && new Date(b.dueDate) < new Date();
                      return (
                        <TableRow key={b.id} className={b.id === focusBillId ? "bg-primary/5" : ""}>
                          <TableCell>
                            {b.type === "PURCHASE_INVOICE"
                              ? <button className="underline-offset-2 hover:underline font-mono text-xs" onClick={() => router.push(`/dashboard/purchases/${b.id}`)}>{b.docNo}</button>
                              : <span className="font-mono text-xs">{b.docNo} <span className="font-sans text-muted-foreground">(opening)</span></span>}
                          </TableCell>
                          <TableCell className="text-xs">{b.vendorBillNo ?? "-"}</TableCell>
                          <TableCell className="text-xs">{formatDate(b.date)}{overdue && <Badge variant="destructive" className="ml-1">overdue</Badge>}</TableCell>
                          <TableCell className="text-right tabular-nums">{rs(b.total)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rs(b.paid)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rs(b.remaining)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Input aria-label={`Pay now on ${b.docNo}`} aria-invalid={over} className={`h-8 ${over ? "border-destructive" : ""}`} inputMode="decimal" value={alloc[b.id] ?? ""} placeholder="0" onChange={(e) => setAlloc({ ...alloc, [b.id]: clean(e.target.value) })} onFocus={(e) => e.target.select()} />
                              <Button type="button" variant="outline" size="sm" onClick={() => fillBill(b)}>Fill</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <p role="status" className={`mt-2 text-sm ${leftOver < 0 || overAllocated.length ? "text-destructive" : "text-muted-foreground"}`}>
                For bills {rs(allocated)} of {rs(paying)}
                {leftOver > 0 && ` · ${rs(leftOver)} will be kept as an advance with the supplier`}
                {leftOver < 0 && " · more than the amount paid"}
                {overAllocated.length > 0 && ` · ${overAllocated.map((b) => b.docNo).join(", ")}: more than it still owes`}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={submit} disabled={saving || paying <= 0 || leftOver < 0 || overAllocated.length > 0}>{saving ? "Saving..." : "Save payment"}</Button>
            </div>
          </CardContent>
        </Card>

        {shown.credit.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Supplier&apos;s credit (advances and returns): {rs(totalCredit)}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Kind</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Not yet used</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {shown.credit.map((c) => (
                    <TableRow key={c.sourceId}>
                      <TableCell className="font-mono text-xs">{c.docNo}</TableCell>
                      <TableCell className="text-xs">{c.kind}</TableCell>
                      <TableCell className="text-xs">{formatDate(c.date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(c.unapplied)}</TableCell>
                      <TableCell className="text-right">
                        {shown.bills.length > 0 && (
                          <Button variant="outline" size="sm" onClick={() => setApplyFor({ sourceId: c.sourceId, billId: shown.bills[0].id, amount: String(Math.min(Number(c.unapplied), Number(shown.bills[0].remaining))) })}>
                            <CornerDownRight className="h-3.5 w-3.5 mr-1" aria-hidden /> Use for a bill
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {applyFor && (
                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-4 sm:items-end">
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Bill</Label>
                    <Select value={applyFor.billId} onChange={(v: string) => setApplyFor({ ...applyFor, billId: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{shown.bills.map((b) => <SelectItem key={b.id} value={b.id}>{b.docNo}{b.vendorBillNo ? ` (${b.vendorBillNo})` : ""}: payable {rs(b.remaining)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label htmlFor="apply-amount">Amount</Label><Input id="apply-amount" inputMode="decimal" value={applyFor.amount} onChange={(e) => setApplyFor({ ...applyFor, amount: clean(e.target.value) })} /></div>
                  <div className="flex gap-2"><Button onClick={applyCredit} disabled={saving}>Use</Button><Button variant="ghost" onClick={() => setApplyFor(null)}>Close</Button></div>
                </div>
              )}

              <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-4 sm:items-end">
                <div className="space-y-1"><Label htmlFor="refund-amount">Refund received (Rs)</Label><Input id="refund-amount" inputMode="decimal" value={refund.amount} placeholder={String(totalCredit)} onChange={(e) => setRefund({ ...refund, amount: clean(e.target.value) })} /></div>
                <div className="space-y-1">
                  <Label>Into</Label>
                  <Select value={refund.method} onChange={(v: string) => setRefund({ ...refund, method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label htmlFor="refund-ref">Reference</Label><Input id="refund-ref" value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} /></div>
                <Button variant="outline" onClick={doRefund} disabled={saving || !(Number(refund.amount) > 0)}><Undo2 className="h-4 w-4 mr-1" aria-hidden /> Supplier refunded this</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </>)}
    </div>
  );
}
