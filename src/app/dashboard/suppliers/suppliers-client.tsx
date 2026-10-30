"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { formatPaisa } from "@/lib/utils";
import { SupplierForm } from "./supplier-form";

export interface SupplierRow {
  id: string; name: string; company: string | null; contactPerson: string | null; phone: string | null; email: string | null; city: string | null;
  isActive: boolean; partyCode: string | null; balance: string; bills: number;
}

export default function SuppliersClient({ suppliers, canEdit, filters }: { suppliers: SupplierRow[]; canEdit: boolean; filters: { search: string; status: string; owed: boolean } }) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search);
  const [adding, setAdding] = useState(false);
  const go = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/dashboard/suppliers?${params.toString()}`);
  };
  const totalOwed = suppliers.reduce((t, s) => t + Math.max(0, Number(s.balance)), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description={`${suppliers.length} shown · owed to suppliers ${formatPaisa(totalOwed)}`}
        icon={Truck}
        actions={canEdit ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" aria-hidden /> Add supplier</Button> : undefined}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <form className="relative min-w-[16rem] flex-1" onSubmit={(e) => { e.preventDefault(); go({ search: search.trim() || null }); }}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Search suppliers" className="pl-9" placeholder="Name, contact, phone, e-mail, city... (Enter)" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <div className="flex gap-1" role="group" aria-label="Which suppliers">
            {(["active", "archived", "all"] as const).map((s) => (
              <Button key={s} size="sm" variant={filters.status === s ? "default" : "outline"} aria-pressed={filters.status === s} onClick={() => go({ status: s === "active" ? null : s })}>{s[0].toUpperCase() + s.slice(1)}</Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.owed} onChange={(e) => go({ owed: e.target.checked ? "1" : null })} /> With a balance only</label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {suppliers.length === 0 ? <EmptyState icon={Truck} title="No suppliers found" description="Try another search, or add a supplier." /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Supplier</TableHead><TableHead>Account</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>City</TableHead><TableHead className="text-right">Bills</TableHead><TableHead className="text-right">Balance</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => {
                    const b = Number(s.balance);
                    return (
                      <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/dashboard/suppliers/${s.id}`)}>
                        <TableCell><a href={`/dashboard/suppliers/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{s.name}</a>{s.company && <div className="text-xs text-muted-foreground">{s.company}</div>}{!s.isActive && <Badge variant="secondary" className="ml-1">archived</Badge>}</TableCell>
                        <TableCell className="font-mono text-xs">{s.partyCode ?? "-"}</TableCell>
                        <TableCell className="text-sm">{s.contactPerson ?? "-"}</TableCell>
                        <TableCell className="text-sm">{s.phone ?? "-"}</TableCell>
                        <TableCell className="text-sm">{s.city ?? "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.bills}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{b === 0 ? "-" : b > 0 ? `${formatPaisa(b)} owed` : `${formatPaisa(-b)} Dr`}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {adding && <SupplierForm open onClose={() => setAdding(false)} onSaved={(s) => { setAdding(false); router.push(`/dashboard/suppliers/${s.id}`); }} />}
    </div>
  );
}
