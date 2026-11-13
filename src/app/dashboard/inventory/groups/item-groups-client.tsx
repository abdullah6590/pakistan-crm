// src/app/dashboard/inventory/groups/item-groups-client.tsx - The item groups list, the "Add group" form and the
// group price per kg (old Item Group "Price", Report 32 phase 1): changing it can also set the purchase rate of the
// group's products, after the screen has said how many will change and that number is confirmed.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Boxes, ChevronRight, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

interface Group { id: string; name: string; description: string | null; color: string; products: number; ratePerKg: number | null }

const decimal = (t: string) => t.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

export default function ItemGroupsClient({ groups, canAdd }: { groups: Group[]; canAdd: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const taken = groups.some((g) => g.name.toLowerCase() === name.trim().toLowerCase());

  // Price window: the group, the new rate, and how many products would change (asked from the server on opening)
  const [pricing, setPricing] = useState<null | { group: Group; rate: string; products: number | null; update: boolean }>(null);
  const openPrice = async (g: Group) => {
    setPricing({ group: g, rate: g.ratePerKg ? String(g.ratePerKg) : "", products: null, update: false });
    const r = await fetch(`/api/categories/${g.id}`);
    const d = await r.json().catch(() => ({}));
    setPricing((p) => (p && p.group.id === g.id ? { ...p, products: r.ok ? d.products : 0 } : p));
  };
  async function savePrice() {
    if (!pricing) return;
    const value = pricing.rate.trim() === "" ? null : Number(pricing.rate);
    if (pricing.update && value === null) { toast.error("Enter the price per kg to set on the products"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/categories/${pricing.group.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratePerKg: value, updateProducts: pricing.update, confirmCount: pricing.update ? pricing.products ?? 0 : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The price was not saved");
      toast.success(pricing.update ? `Price saved; purchase rate updated on ${data.productsUpdated} products` : "Group price saved");
      setPricing(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The price was not saved");
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || taken) return;
    setBusy(true);
    try {
      const res = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: description.trim() || null, ratePerKg: rate.trim() || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The group was not saved");
      toast.success(`Group "${data.category.name}" added`);
      setName("");
      setDescription("");
      setRate("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The group was not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Item groups" description="Groups of products, e.g. Board, Duplex, Paper, each with its purchase price per kg. Open a group to see its products." icon={Boxes} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardContent className="p-0">
            {groups.length === 0 ? (
              <EmptyState icon={Boxes} title="No groups yet" description="Add the first group with the form." />
            ) : (
              <ul className="divide-y" aria-label="Item groups">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center">
                    <Link href={`/dashboard/inventory?categoryId=${g.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{g.name}</span>
                        {g.description && <span className="block truncate text-sm text-muted-foreground">{g.description}</span>}
                      </span>
                      <span className="text-sm tabular-nums">{g.ratePerKg ? `Rs ${g.ratePerKg}/kg` : <span className="text-muted-foreground">no price</span>}</span>
                      <span className="w-24 text-right text-sm text-muted-foreground tabular-nums">{g.products} {g.products === 1 ? "product" : "products"}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </Link>
                    {canAdd && (
                      <Button variant="ghost" size="sm" className="mr-2" onClick={() => void openPrice(g)} aria-label={`Set price of ${g.name}`}>
                        <Tag className="mr-1 h-4 w-4" aria-hidden /> Price
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {canAdd && (
          <Card className="h-fit">
            <CardHeader><CardTitle className="text-base">Add group</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={add} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="group-name">Name</Label>
                  <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Duplex board" autoComplete="off" aria-invalid={taken} aria-describedby={taken ? "group-name-taken" : undefined} />
                  {taken && <p id="group-name-taken" className="text-sm text-destructive">A group with this name already exists.</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-rate">Purchase price per kg (optional)</Label>
                  <Input id="group-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(decimal(e.target.value))} autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-description">Description (optional)</Label>
                  <Input id="group-description" value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
                </div>
                <Button type="submit" className="w-full" disabled={busy || !name.trim() || taken}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden />{busy ? "Saving..." : "Add group"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!pricing} onClose={() => !busy && setPricing(null)}>
        {pricing && (<>
          <DialogHeader>
            <DialogTitle>Price of {pricing.group.name}</DialogTitle>
            <DialogDescription>New products in this group start with this purchase rate per kg. Bills already saved keep their own prices.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="price-rate">Purchase price per kg (Rs)</Label>
              <Input id="price-rate" inputMode="decimal" autoFocus value={pricing.rate} onChange={(e) => setPricing({ ...pricing, rate: decimal(e.target.value) })} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={pricing.update} disabled={!pricing.products}
                onChange={(e) => setPricing({ ...pricing, update: e.target.checked })} />
              <span>
                Also set this as the purchase rate of the group&apos;s products
                <span className="block text-muted-foreground" aria-live="polite">
                  {pricing.products === null ? "Counting products…" : pricing.products === 0 ? "This group has no products." : `${pricing.products} ${pricing.products === 1 ? "product" : "products"} will change.`}
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPricing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void savePrice()} disabled={busy || pricing.products === null}>
              {busy ? "Saving…" : pricing.update ? `Save and update ${pricing.products} ${pricing.products === 1 ? "product" : "products"}` : "Save price"}
            </Button>
          </DialogFooter>
        </>)}
      </Dialog>
    </div>
  );
}
