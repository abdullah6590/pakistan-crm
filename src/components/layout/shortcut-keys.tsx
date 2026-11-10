"use client";
// src/components/layout/shortcut-keys.tsx - Listens for the user's keyboard shortcuts on every page and opens the
// section; Alt+/ (by default) shows the list. The keys come from Settings -> Keyboard shortcuts.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { comboFromEvent, defaultShortcuts, SHORTCUT_ACTIONS, type ShortcutMap } from "@/lib/shortcuts";
import { OPEN_SEARCH } from "./global-search";

/** Fired by the settings page after saving, so the new keys work at once. */
export const SHORTCUTS_CHANGED = "crm-shortcuts-changed";

export function KeyCombo({ combo }: { combo: string }) {
  if (!combo) return <span className="text-xs text-muted-foreground">off</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {combo.split("+").map((k, i) => (
        <kbd key={i} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
      ))}
    </span>
  );
}

export default function ShortcutKeys() {
  const router = useRouter();
  const [map, setMap] = useState<ShortcutMap>(defaultShortcuts);
  const [helpOpen, setHelpOpen] = useState(false);

  // The user's keys, loaded once and again whenever the settings page saves new ones
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/me/shortcuts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data?.shortcuts) setMap(data.shortcuts); })
      .catch(() => { /* offline for a moment: the defaults keep working */ });
    load();
    window.addEventListener(SHORTCUTS_CHANGED, load);
    return () => { alive = false; window.removeEventListener(SHORTCUTS_CHANGED, load); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Paused while a key is being recorded and while "Choose your layout" is open
      if (e.repeat || e.isComposing || document.body.dataset.shortcutRecording || document.body.dataset.layoutChoice) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const id = Object.entries(map).find(([, c]) => c && c === combo)?.[0];
      const action = id && SHORTCUT_ACTIONS.find((a) => a.id === id);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.href === "#help") setHelpOpen((open) => !open);
      else if (action.href === "#search") { setHelpOpen(false); window.dispatchEvent(new Event(OPEN_SEARCH)); }
      else { setHelpOpen(false); router.push(action.href); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [map, router]);

  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))];
  return (
    <Dialog open={helpOpen} onClose={() => setHelpOpen(false)}>
      <DialogHeader>
        <DialogTitle><span className="inline-flex items-center gap-2"><Keyboard className="h-5 w-5" aria-hidden />Keyboard shortcuts</span></DialogTitle>
        <DialogDescription>Press the keys together to open the section from any page.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</h3>
            <ul className="divide-y rounded-md border">
              {SHORTCUT_ACTIONS.filter((a) => a.group === g).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span>{a.label}</span>
                  <KeyCombo combo={map[a.id] ?? ""} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-4 text-sm">
        <Link className="text-primary underline" href="/dashboard/settings/shortcuts" onClick={() => setHelpOpen(false)}>Change your shortcuts</Link>
      </p>
    </Dialog>
  );
}
