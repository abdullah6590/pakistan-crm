// src/components/shared/new-customer-dialog.tsx - Register a customer without leaving the current screen (e.g. a
// new sale). Same fields as Customers → Add Customer; possible duplicates (same phone or similar name) are shown
// before saving. On success the new customer is handed back so the screen can select it.
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface NewCustomer { id: string; name: string; phone: string }

interface Props {
  open: boolean;
  /** What was typed in the search box: a phone number fills Phone, anything else fills Name */
  initialText?: string;
  onClose: () => void;
  onCreated: (customer: NewCustomer) => void;
}

const emptyForm = { name: "", email: "", phone: "", city: "", address: "", notes: "" };

/** Starting values from what was typed in the search box. */
function startFrom(text: string) {
  const t = text.trim();
  const looksLikePhone = /^[+\d][\d\s-]{5,}$/.test(t);
  return { ...emptyForm, name: looksLikePhone ? "" : t, phone: looksLikePhone ? t : "" };
}

/** Mount it fresh for each opening (the caller changes its `key`), so it starts from the latest typed text. */
export function NewCustomerDialog({ open, initialText = "", onClose, onCreated }: Props) {
  const [form, setForm] = useState(() => startFrom(initialText));
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<NewCustomer[]>([]);
  const terms = [form.name.trim(), form.phone.replace(/\D/g, "").slice(-7)].filter((t) => t.length >= 3);
  const termsKey = terms.join("|");

  // Possible duplicates: existing customers matching the name or the phone
  useEffect(() => {
    if (!open || !termsKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = new Map<string, NewCustomer>();
        for (const q of termsKey.split("|")) {
          const res = await fetch(`/api/search/customers?q=${encodeURIComponent(q)}&limit=5`, { signal: controller.signal });
          const data = await res.json();
          for (const c of data.data ?? []) found.set(c.id, c);
        }
        setSimilar([...found.values()]);
      } catch { /* aborted or offline: no warning */ }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, termsKey]);
  const shownSimilar = termsKey ? similar : [];

  const save = async () => {
    if (!form.name.trim()) { toast.error("Customer name is required"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          city: form.city.trim() || undefined,
          address: form.address.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(res.status === 403 ? "You are not allowed to add customers; ask an administrator" : data.error || "Could not add the customer");
      toast.success(`Customer ${data.customer.name} added`);
      onCreated({ id: data.customer.id, name: data.customer.name, phone: data.customer.phone ?? "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label>Name *</Label>
          <Input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Customer name" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" type="email" />
          </div>
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+92 300 1234567" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>City</Label>
            <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" />
          </div>
          <div className="space-y-1">
            <Label>Address</Label>
            <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address" />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Notes</Label>
          <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" />
        </div>

        {shownSimilar.length > 0 && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 font-medium text-sm">
              <AlertTriangle className="h-4 w-4" /> Possible duplicates
            </div>
            <ul className="text-xs space-y-1 ml-6">
              {shownSimilar.map(c => (
                <li key={c.id} className="list-disc">
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => onCreated(c)} title="Use this customer instead">
                    <strong>{c.name}</strong> {c.phone && `(${c.phone})`} — use this one
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Add Customer"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
