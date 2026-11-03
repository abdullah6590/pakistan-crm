"use client";
// src/app/dashboard/accounting/ledger/account-picker.tsx - Choose the ledger account by typing part of its name, code or
// phone; the list is grouped (customers, suppliers, cash and bank, other accounts) and narrows as you type.
import { useState } from "react";
import { Input } from "@/components/ui/input";

export interface PickerAccount { id: string; code: string; name: string; kind: string; subType: string | null; phone: string | null; isActive: boolean }

const GROUPS: { title: string; test: (a: PickerAccount) => boolean }[] = [
  { title: "Customers", test: (a) => a.kind === "PARTY" && a.subType === "CUSTOMER" },
  { title: "Suppliers", test: (a) => a.kind === "PARTY" && a.subType === "SUPPLIER" },
  { title: "Other parties", test: (a) => a.kind === "PARTY" && a.subType !== "CUSTOMER" && a.subType !== "SUPPLIER" },
  { title: "Cash and bank", test: (a) => a.kind === "CASH_BANK" },
  { title: "Other accounts", test: (a) => a.kind !== "PARTY" && a.kind !== "CASH_BANK" },
];

export default function AccountPicker({ accounts, value }: { accounts: PickerAccount[]; value?: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(value ?? "");
  const q = query.trim().toLowerCase();
  const shown = q ? accounts.filter((a) => `${a.code} ${a.name} ${a.phone ?? ""}`.toLowerCase().includes(q)) : accounts;
  // While searching, the first match is chosen unless the current choice still matches
  const current = shown.some((a) => a.id === selected) ? selected : q ? shown[0]?.id ?? "" : selected;
  return (
    <div className="grid gap-2 sm:grid-cols-2 md:col-span-2">
      <Input aria-label="Search accounts" placeholder="Type a name, code or phone..." value={query} onChange={(e) => setQuery(e.target.value)} />
      <select name="account" aria-label="Account" required value={current} onChange={(e) => setSelected(e.target.value)}
        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
        <option value="">{shown.length ? "Choose an account" : "No account matches"}</option>
        {GROUPS.map((g) => {
          const list = shown.filter(g.test);
          return list.length ? (
            <optgroup key={g.title} label={g.title}>
              {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ""} ({a.code}){a.isActive ? "" : " (inactive)"}</option>)}
            </optgroup>
          ) : null;
        })}
      </select>
    </div>
  );
}
