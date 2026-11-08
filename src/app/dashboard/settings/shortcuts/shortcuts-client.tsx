"use client";
// src/app/dashboard/settings/shortcuts/shortcuts-client.tsx - Each user sets their own keys: click Change, press the
// keys; clashes and keys the browser needs are pointed out before saving.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Keyboard, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyCombo, SHORTCUTS_CHANGED } from "@/components/layout/shortcut-keys";
import { comboFromEvent, comboProblem, conflicts, SHORTCUT_ACTIONS, type ShortcutMap } from "@/lib/shortcuts";

export default function ShortcutsClient({ initial, defaults }: { initial: ShortcutMap; defaults: ShortcutMap }) {
  const [map, setMap] = useState<ShortcutMap>(initial);
  const [recording, setRecording] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const clashes = useMemo(() => conflicts(map), [map]);
  const changed = JSON.stringify(map) !== JSON.stringify(initial);

  // While waiting for keys, the page's own shortcuts are paused and the next combination is taken
  useEffect(() => {
    if (!recording) { delete document.body.dataset.shortcutRecording; return; }
    document.body.dataset.shortcutRecording = "1";
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // still holding Alt/Ctrl/Shift
      const why = comboProblem(combo);
      if (why) { setProblem({ id: recording, text: why }); return; }
      setProblem(null);
      setMap((m) => ({ ...m, [recording]: combo }));
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); delete document.body.dataset.shortcutRecording; };
  }, [recording]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/shortcuts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortcuts: map }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      window.dispatchEvent(new Event(SHORTCUTS_CHANGED));
      toast.success("Shortcuts saved: they work now");
      setMap(data.shortcuts);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clashWith = (id: string) => {
    const ids = map[id] ? clashes[map[id]] : undefined;
    return ids ? ids.filter((x) => x !== id).map((x) => SHORTCUT_ACTIONS.find((a) => a.id === x)?.label).join(", ") : null;
  };
  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg"><Keyboard className="h-5 w-5" aria-hidden />Your keyboard shortcuts</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setMap(defaults); setProblem(null); }}><RotateCcw className="mr-1 h-4 w-4" aria-hidden />Reset all to default</Button>
          <Button size="sm" disabled={!changed || saving || Object.keys(clashes).length > 0} onClick={save}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Click <strong>Change</strong>, then press the keys together (for example Alt and S). Esc cancels. Press <KeyCombo combo={map.help || "Alt+/"} /> on any page to see this list.
        </p>
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</h3>
            <ul className="divide-y rounded-md border">
              {SHORTCUT_ACTIONS.filter((a) => a.group === g).map((a) => {
                const clash = clashWith(a.id);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-[12rem] flex-1">{a.label}</span>
                    {recording === a.id
                      ? <span role="status" className="animate-pulse rounded border border-primary px-2 py-0.5 text-xs text-primary">Press the keys now… (Esc cancels)</span>
                      : <KeyCombo combo={map[a.id] ?? ""} />}
                    <div className="ml-auto flex gap-1">
                      <Button variant="outline" size="sm" aria-label={`Change the shortcut for ${a.label}`} onClick={() => { setProblem(null); setRecording(recording === a.id ? null : a.id); }}>{recording === a.id ? "Cancel" : "Change"}</Button>
                      <Button variant="ghost" size="sm" aria-label={`Turn off the shortcut for ${a.label}`} disabled={!map[a.id]} onClick={() => setMap((m) => ({ ...m, [a.id]: "" }))}>Turn off</Button>
                      <Button variant="ghost" size="sm" aria-label={`Default shortcut for ${a.label}`} disabled={map[a.id] === defaults[a.id]} onClick={() => setMap((m) => ({ ...m, [a.id]: defaults[a.id] }))}>Default</Button>
                    </div>
                    {problem?.id === a.id && <p role="alert" className="w-full text-xs text-destructive">{problem.text}. Try another combination.</p>}
                    {clash && <p role="alert" className="w-full text-xs text-amber-700 dark:text-amber-400">Also given to {clash}: change one of them before saving.</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
