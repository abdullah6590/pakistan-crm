// src/components/layout/interface-switch.tsx - Switching between the modern (sidebar) and classic (menu bar)
// interface. The choice is the user's own and is kept on the server, so it follows them to every computer.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PanelLeft, PanelTop } from "lucide-react";
import type { UiLayout } from "@/lib/interface-pref";
import { cn } from "@/lib/utils";

export const LAYOUT_TEXT: Record<UiLayout, { name: string; detail: string }> = {
  modern: { name: "Modern", detail: "Sections in a sidebar on the left" },
  classic: { name: "Classic", detail: "Menu bar at the top, like the old program" },
};

export function useInterfaceSwitch() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function switchTo(layout: UiLayout) {
    setBusy(true);
    try {
      const res = await fetch("/api/me/interface", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "The interface was not changed");
      router.refresh();
      toast.success(`${LAYOUT_TEXT[layout].name} interface on`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The interface was not changed");
    } finally {
      setBusy(false);
    }
  }
  return { switchTo, busy };
}

/** Two cards to choose the interface (Settings). */
export function InterfaceChoice({ current }: { current: UiLayout }) {
  const { switchTo, busy } = useInterfaceSwitch();
  return (
    <div role="radiogroup" aria-label="Interface" className="grid gap-3 sm:grid-cols-2">
      {(["modern", "classic"] as const).map((l) => {
        const Icon = l === "modern" ? PanelLeft : PanelTop;
        const on = current === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => { if (!on) switchTo(l); }}
            className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 cursor-pointer", on && "border-primary bg-primary/5")}
          >
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted", on && "bg-primary text-primary-foreground")} aria-hidden><Icon className="h-5 w-5" /></span>
            <span>
              <span className="block font-medium">{LAYOUT_TEXT[l].name}{on ? " (in use)" : ""}</span>
              <span className="block text-sm text-muted-foreground">{LAYOUT_TEXT[l].detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
