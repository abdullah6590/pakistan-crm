"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Wallet, Undo2, CornerDownRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

interface CustomerOption { id: string; name: string; phone: string }
interface AccountOption { id: string; name: string; subType: string | null; code: string }
interface MethodOption { value: string; label: string; subType: string; code: string }
interface OpenInvoice { id: string; docNo: string; date: string; total: string; paid: string; remaining: string }
interface Credit { receiptId: string; receiptNo: string; date: string; total: string; unapplied: string }
interface Account { customer: CustomerOption; partyAccountId: string | null; balance: string; invoices: OpenInvoice[]; credit: Credit[] }

interface Props {
  customers: CustomerOption[];
  accounts: AccountOption[];
  methods: MethodOption[];
  initialCustomerId: string | null;
  focusInvoiceId: string | null;
  canRefund: boolean;
}

const rs = (v: string | number) => formatCurrency(Number(v));
const today = () => new Date().toISOString().slice(0, 10);
const clean = (t: string) => {
  const [w, ...rest] = t.replace(/[^\d.]/g, "").split(".");
  const whole = w.replace(/^0+(?=\d)/, "");
  return rest.length ? `${whole || "0"}.${rest.join("").slice(0, 2)}` : whole;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PaymentsClient({ customers, accounts, methods, initialCustomerId, focusInvoiceId, canRefund }: Props) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [cashAccountId, setCashAccountId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [applyFor, setApplyFor] = useState<{ receiptId: string; invoiceId: string; amount: string } | null>(null);
  const [refund, setRefund] = useState({ amount: "", method: "CASH" });

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/sales/payments?customerId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the customer");
      setAccount(data.account);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the customer");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!customerId) return;
    let stale = false;
    (async () => {
      const res = await fetch(`/api/sales/payments?customerId=${encodeURIComponent(customerId)}`);
      const data = await res.json();
      if (stale) return;
      if (!res.ok) { toast.error(data.error || "Could not load the customer"); return; }
      setAccount(data.account);
      if (focusInvoiceId) {
        const inv = (data.account as Account).invoices.find((i) => i.id === focusInvoiceId);
        if (inv) { setAlloc({ [inv.id]: inv.remaining }); setAmount(inv.remaining); }
      }
    })();
    return () => { stale = true; };
  }, [customerId, focusInvoiceId]);

  const methodAccounts = useMemo(() => {
    const m = methods.find((x) => x.value === method);
    return accounts.filter((a) => a.subType === m?.subType);
  }, [accounts, methods, method]);

  const allocated = Object.values(alloc).reduce((t, v) => t + (parseFloat(v) || 0), 0);
  const received = parseFloat(amount) || 0;
  const leftOver = round2(received - allocated);
  const shown = account && account.customer.id === customerId ? account : null;
  const matches = query.trim() ? customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];

  const fillInvoice = (inv: OpenInvoice) => {
    const others = allocated - (parseFloat(alloc[inv.id] ?? "") || 0);
    const room = received > 0 ? Math.max(0, round2(received - others)) : Number(inv.remaining);
    setAlloc({ ...alloc, [inv.id]: String(Math.min(Number(inv.remaining), room)) });
    if (received === 0) setAmount(String(round2(others + Number(inv.remaining))));
  };

  const submit = async () => {
    if (!shown) return;
    if (received <= 0) { toast.error("Enter the amount received"); return; }
    if (leftOver < 0) { toast.error("The amounts for bills add up to more than the amount received"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/sales/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId, date, amount, method, cashAccountId: cashAccountId || undefined, remarks: remarks.trim() || undefined, requestId,
          allocations: Object.entries(alloc).filter(([, v]) => (parseFloat(v) || 0) > 0).map(([invoiceId, v]) => ({ invoiceId, amount: v })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the payment");
      if (data.pending) {
        toast.success(`Saved on this computer as ${data.entry.provisionalRef ?? "a pending entry"}; it gets its number when it syncs with the main server`, { duration: 10000 });
        setAmount(""); setAlloc({}); setRemarks(""); setRequestId(crypto.randomUUID());
        return;
      }
      toast.success(`Receipt ${data.receipt.docNo} saved${leftOver > 0 ? `; ${rs(leftOver)} kept as the customer's credit` : ""}`, {
        action: { label: "Receipt PDF", onClick: () => window.open(`/api/sales/receipts/${data.receipt.id}/pdf`, "_blank") },
      });
      setAmount(""); setAlloc({}); setRemarks(""); setRequestId(crypto.randomUUID());
      await load(customerId);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the payment");
    } finally {
      setSaving(false);
    }
  };

  const applyCredit = async () => {
    if (!applyFor) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sales/payments/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...applyFor, requestId: crypto.randomUUID() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not apply the credit");
      toast.success("Credit applied to the bill");
      setApplyFor(null);
      await load(customerId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the credit");
    } finally {
      setSaving(false);
    }
  };

  const doRefund = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/sales/payments/refund", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, date, amount: refund.amount, method: refund.method, requestId: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the refund");
      toast.success(`Refund ${data.refund.docNo} saved`);
      setRefund({ amount: "", method: "CASH" });
      await load(customerId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the refund");
    } finally {
      setSaving(false);
    }
  };

  const totalCredit = shown?.credit.reduce((t, c) => t + Number(c.unapplied), 0) ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to Sales" onClick={() => router.push("/dashboard/sales")}><ArrowLeft className="h-5 w-5" aria-hidden /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receive payment</h1>
          <p className="text-sm text-muted-foreground">Money from a customer, and the bills it pays. Nothing is applied to a bill unless you enter it.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {shown ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <p className="font-medium">{shown.customer.name}</p>
                <p className="text-xs text-muted-foreground">
                  Balance {Number(shown.balance) >= 0 ? `owed to you ${rs(shown.balance)}` : `in the customer's favour ${rs(-Number(shown.balance))}`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setCustomerId(""); setAccount(null); setAlloc({}); }}>Change</Button>
            </div>
          ) : (
            <div className="relative">
              <Input placeholder="Search customer by name or phone..." value={query} onChange={(e) => setQuery(e.target.value)} />
              {matches.length > 0 && (
                <div className="absolute z-20 top-full mt-1 w-full border rounded-lg bg-background shadow-lg">
                  {matches.map((c) => (
                    <button key={c.id} type="button" className="w-full px-3 py-2 text-left hover:bg-muted text-sm" onClick={() => { setCustomerId(c.id); setQuery(""); setAlloc({}); }}>
                      <span className="font-medium">{c.name}</span> {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              {loading && <p className="text-xs text-muted-foreground mt-1">Loading...</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {shown && (<>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" /> Payment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Amount received (Rs)</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(clean(e.target.value))} onFocus={(e) => e.target.select()} /></div>
              <div className="space-y-1">
                <Label>Method</Label>
                <Select value={method} onChange={(v: string) => { setMethod(v); setCashAccountId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Into account</Label>
                <Select value={cashAccountId || "default"} onChange={(v: string) => setCashAccountId(v === "default" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default for {methods.find((m) => m.value === method)?.label}</SelectItem>
                    {methodAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Remarks</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. cheque no., who paid" /></div>
            </div>

            <div>
              <Label>Bills this payment is for</Label>
              {shown.invoices.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No unpaid bills. The whole amount will be kept as the customer&apos;s credit (an advance).</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="w-[170px]">Pay now</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {shown.invoices.map((inv) => (
                      <TableRow key={inv.id} className={inv.id === focusInvoiceId ? "bg-primary/5" : ""}>
                        <TableCell><button className="underline-offset-2 hover:underline font-mono text-xs" onClick={() => router.push(`/dashboard/sales/${inv.id}`)}>{inv.docNo}</button></TableCell>
                        <TableCell className="text-xs">{formatDate(inv.date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rs(inv.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rs(inv.remaining)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Input className="h-8" inputMode="decimal" value={alloc[inv.id] ?? ""} placeholder="0" onChange={(e) => setAlloc({ ...alloc, [inv.id]: clean(e.target.value) })} onFocus={(e) => e.target.select()} />
                            <Button type="button" variant="outline" size="sm" onClick={() => fillInvoice(inv)}>Fill</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className={`mt-2 text-sm ${leftOver < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                For bills {rs(allocated)} of {rs(received)}
                {leftOver > 0 && ` · ${rs(leftOver)} will be kept as the customer's credit`}
                {leftOver < 0 && " · more than received"}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={submit} disabled={saving || received <= 0 || leftOver < 0}>{saving ? "Saving..." : "Save payment"}</Button>
            </div>
          </CardContent>
        </Card>

        {shown.credit.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Customer&apos;s credit: {rs(totalCredit)}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Not yet used</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {shown.credit.map((c) => (
                    <TableRow key={c.receiptId}>
                      <TableCell className="font-mono text-xs">{c.receiptNo}</TableCell>
                      <TableCell className="text-xs">{formatDate(c.date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(c.unapplied)}</TableCell>
                      <TableCell className="text-right">
                        {shown.invoices.length > 0 && (
                          <Button variant="outline" size="sm" onClick={() => setApplyFor({ receiptId: c.receiptId, invoiceId: shown.invoices[0].id, amount: String(Math.min(Number(c.unapplied), Number(shown.invoices[0].remaining))) })}>
                            <CornerDownRight className="h-3.5 w-3.5 mr-1" /> Apply to a bill
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
                    <Select value={applyFor.invoiceId} onChange={(v: string) => setApplyFor({ ...applyFor, invoiceId: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{shown.invoices.map((i) => <SelectItem key={i.id} value={i.id}>{i.docNo} (remaining {rs(i.remaining)})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Amount</Label><Input inputMode="decimal" value={applyFor.amount} onChange={(e) => setApplyFor({ ...applyFor, amount: clean(e.target.value) })} /></div>
                  <div className="flex gap-2"><Button onClick={applyCredit} disabled={saving}>Apply</Button><Button variant="ghost" onClick={() => setApplyFor(null)}>Close</Button></div>
                </div>
              )}

              {canRefund && (
                <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-4 sm:items-end">
                  <div className="space-y-1"><Label>Refund amount</Label><Input inputMode="decimal" value={refund.amount} placeholder={String(totalCredit)} onChange={(e) => setRefund({ ...refund, amount: clean(e.target.value) })} /></div>
                  <div className="space-y-1">
                    <Label>Paid from</Label>
                    <Select value={refund.method} onChange={(v: string) => setRefund({ ...refund, method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{methods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2"><Button variant="outline" onClick={doRefund} disabled={saving || !(Number(refund.amount) > 0)}><Undo2 className="h-4 w-4 mr-1" /> Refund to customer</Button></div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end">
          <a className={buttonVariants({ variant: "outline" })} href={`/api/sales/statement/${customerId}/pdf`} download>Customer statement (PDF)</a>
        </div>
      </>)}
    </div>
  );
}
