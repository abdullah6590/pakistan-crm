// src/app/dashboard/inventory/groups/item-groups-client.tsx - The item groups list and the "Add group" form.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Boxes, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

interface Group { id: string; name: string; description: string | null; color: string; products: number }

export default function ItemGroupsClient({ groups, canAdd }: { groups: Group[]; canAdd: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const taken = groups.some((g) => g.name.toLowerCase() === name.trim().toLowerCase());

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || taken) return;
    setBusy(true);
    try {
      const res = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: description.trim() || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The group was not saved");
      toast.success(`Group "${data.category.name}" added`);
      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The group was not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Item groups" description="Groups of products, e.g. Board, Duplex, Paper. Open a group to see its products." icon={Boxes} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardContent className="p-0">
            {groups.length === 0 ? (
              <EmptyState icon={Boxes} title="No groups yet" description="Add the first group with the form." />
            ) : (
              <ul className="divide-y" aria-label="Item groups">
                {groups.map((g) => (
                  <li key={g.id}>
                    <Link href={`/dashboard/inventory?categoryId=${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{g.name}</span>
                        {g.description && <span className="block truncate text-sm text-muted-foreground">{g.description}</span>}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">{g.products} {g.products === 1 ? "product" : "products"}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </Link>
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
    </div>
  );
}
