"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface SupplierDetails {
  id?: string; name: string; company: string | null; contactPerson: string | null; email: string | null; phone: string | null;
  address: string | null; city: string | null; country: string | null; taxNumber: string | null; notes: string | null; customFields: string | null;
}

const FIELDS: [keyof SupplierDetails, string, string?][] = [
  ["name", "Name *"], ["company", "Company / trading name"], ["contactPerson", "Contact person"], ["phone", "Phone", "tel"], ["email", "E-mail", "email"],
  ["taxNumber", "NTN / STRN / registration"], ["city", "City"], ["country", "Country"],
];

function parseCustom(json: string | null): { label: string; value: string }[] {
  try {
    const list = JSON.parse(json ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Add or edit a supplier, with the duplicate check and the owner's own extra details (label and value pairs). */
export function SupplierForm({ open, initial, onClose, onSaved }: { open: boolean; initial?: SupplierDetails; onClose: () => void; onSaved: (s: SupplierDetails & { id: string }) => void }) {
  const [form, setForm] = useState<SupplierDetails>(initial ?? { name: "", company: null, contactPerson: null, email: null, phone: null, address: null, city: null, country: "Pakistan", taxNumber: null, notes: null, customFields: null });
  const [custom, setCustom] = useState(() => parseCustom(initial?.customFields ?? null));
  const [duplicates, setDuplicates] = useState<{ name: string; isActive: boolean; match: string }[]>([]);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const editing = !!initial?.id;

  const save = async () => {
    if (!form.name.trim()) { toast.error("Enter the supplier's name"); return; }
    setBusy(true);
    try {
      const body = {
        ...Object.fromEntries(FIELDS.map(([k]) => [k, (form[k] as string | null)?.trim() || null]).concat([["address", form.address?.trim() || null], ["notes", form.notes?.trim() || null]])),
        name: form.name.trim(),
        customFields: custom.filter((c) => c.label.trim()),
        ...(why.trim() ? { confirmNotDuplicate: why.trim() } : {}),
      };
      const res = await fetch(editing ? `/api/suppliers/${initial!.id}` : "/api/suppliers", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.status === 409 && data.details?.duplicates) { setDuplicates(data.details.duplicates); toast.error(data.error); return; }
      if (!res.ok) throw new Error(data.error || "Could not save the supplier");
      toast.success(editing ? "Supplier details saved" : `${data.supplier.name} added`);
      onSaved(data.supplier);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof SupplierDetails, label: string, type?: string) => (
    <div key={k} className="space-y-1">
      <Label htmlFor={`sf-${k}`}>{label}</Label>
      <Input id={`sf-${k}`} type={type ?? "text"} value={(form[k] as string | null) ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${initial!.name}` : "New supplier"}</DialogTitle>
        <DialogDescription>{editing ? "Changes are kept in the supplier's history." : "The supplier gets their own account reference when the first bill or payment is entered."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">{FIELDS.map(([k, label, type]) => field(k, label, type))}</div>
        <div className="space-y-1"><Label htmlFor="sf-address">Address</Label><Textarea id="sf-address" rows={2} value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="sf-notes">Notes</Label><Textarea id="sf-notes" rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        <div className="space-y-2">
          <Label>Other details</Label>
          {custom.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label="Detail name" placeholder="e.g. Bank account" value={c.label} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label="Detail value" placeholder="value" value={c.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Remove detail" onClick={() => setCustom(custom.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setCustom([...custom, { label: "", value: "" }])}><Plus className="mr-1 h-4 w-4" aria-hidden /> Add a detail</Button>
        </div>
        {duplicates.length > 0 && (
          <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p>This looks like an existing supplier: {duplicates.map((d) => `${d.name} (same ${d.match}${d.isActive ? "" : ", archived"})`).join(", ")}. Use that supplier, or say why this one is different.</p>
            <Input aria-label="Why this is a different supplier" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. separate branch with its own account" />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button disabled={busy} onClick={save}>{busy ? "Saving..." : editing ? "Save details" : "Add supplier"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
