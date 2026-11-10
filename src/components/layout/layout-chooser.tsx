// src/components/layout/layout-chooser.tsx - "Choose your layout" (owner request 2026-11-10): shown once, after signing
// in, to every user who has not chosen Modern or Classic yet: new users, and everyone coming from a release without the
// Classic interface (0.1.6 and older keep no choice). It cannot be closed without choosing; the choice can be changed
// later from the top-bar button or Settings -> Interface.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UiLayout } from "@/lib/interface-pref";
import { cn } from "@/lib/utils";

const CHOICES: { id: UiLayout; name: string; detail: string }[] = [
  { id: "modern", name: "Modern", detail: "Sections in a side menu on the left, with the new look." },
  { id: "classic", name: "Classic", detail: "Menu bar at the top with the old program's menus and keys." },
];

/** A small drawing of each layout, so the choice is clear before trying it. */
function Picture({ id }: { id: UiLayout }) {
  const bar = "rounded-sm bg-muted-foreground/25";
  return (
    <span className="flex h-24 w-full overflow-hidden rounded-lg border bg-background" aria-hidden>
      {id === "modern" ? (
        <>
          <span className="flex w-1/4 flex-col gap-1.5 border-r bg-muted/60 p-2">
            <span className="h-2 w-full rounded-sm bg-primary/60" />
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn("h-1.5 w-4/5", bar)} />)}
          </span>
          <span className="flex flex-1 flex-col gap-1.5 p-2">
            <span className={cn("h-2 w-1/2", bar)} />
            <span className="mt-1 grid flex-1 grid-cols-3 gap-1.5">
              {[0, 1, 2].map((i) => <span key={i} className="rounded-sm bg-muted" />)}
            </span>
          </span>
        </>
      ) : (
        <span className="flex flex-1 flex-col">
          <span className="flex items-center gap-1.5 border-b bg-muted/60 px-2 py-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={cn("h-3 w-3 rounded-sm", i === 0 ? "bg-primary/60" : "bg-muted-foreground/25")} />)}
          </span>
          <span className="flex flex-1">
            <span className="flex w-[14%] flex-col items-center gap-1.5 border-r py-1.5">
              {[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-2 w-2", bar)} />)}
            </span>
            <span className="flex flex-1 flex-col gap-1.5 p-2">
              <span className={cn("h-2 w-1/2", bar)} />
              <span className="flex-1 rounded-sm bg-muted" />
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

export function LayoutChooser() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<UiLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cards = useRef<(HTMLButtonElement | null)[]>([]);

  // The keyboard shortcuts wait while the choice is open (they would open pages behind it)
  useEffect(() => {
    if (!open) return;
    document.body.dataset.layoutChoice = "1";
    return () => { delete document.body.dataset.layoutChoice; };
  }, [open]);

  // Arrow keys move between the two choices, as in any group of radio buttons
  function onKey(e: React.KeyboardEvent, i: number) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = (i + 1) % CHOICES.length;
    setPicked(CHOICES[next].id);
    cards.current[next]?.focus();
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/me/interface", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: picked }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Your choice was not saved. Please try again.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Your choice was not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => {}} dismissible={false} className="max-w-2xl">
      <div data-layout-chooser>
        <DialogHeader className="pr-0">
          <DialogTitle>Choose your layout</DialogTitle>
          <DialogDescription>
            Both work the same way and show the same records. You can change this any time with the button at the top or in
            Settings &rarr; Interface.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Layout" className="grid gap-3 sm:grid-cols-2">
          {CHOICES.map((c, i) => {
            const on = picked === c.id;
            return (
              <button
                key={c.id}
                ref={(el) => { cards.current[i] = el; }}
                type="button"
                role="radio"
                aria-checked={on}
                // One tab stop for the group: the chosen card, or the first one before anything is chosen
                tabIndex={on || (!picked && i === 0) ? 0 : -1}
                onClick={() => setPicked(c.id)}
                onKeyDown={(e) => onKey(e, i)}
                data-layout={c.id}
                className={cn(
                  "relative flex flex-col gap-3 rounded-xl border-2 p-3 text-left transition-colors duration-150 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                  on ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <Picture id={c.id} />
                <span className="flex items-start gap-2">
                  <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")} aria-hidden>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span>
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-sm text-muted-foreground">{c.detail}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-3">
          {!picked && <span className="text-sm text-muted-foreground">Pick one to continue</span>}
          <Button onClick={save} disabled={!picked || busy} data-layout-save>
            {busy ? "Saving..." : picked ? `Use ${CHOICES.find((c) => c.id === picked)!.name}` : "Use this layout"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
