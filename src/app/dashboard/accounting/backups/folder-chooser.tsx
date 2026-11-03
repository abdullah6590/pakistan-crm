"use client";
// src/app/dashboard/accounting/backups/folder-chooser.tsx - Choose the backup folder inside the page: click a drive,
// click into folders, optionally make a new folder, then "Use this folder". Works the same on the website and in the
// desktop app, and cannot end up hidden behind the browser like the Windows folder window.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder, FolderPlus, HardDrive, Loader2, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Listing { path: string | null; parent: string | null; folders: { name: string; path: string }[]; dataDrive: string | null }
const driveOf = (p: string | null) => /^([A-Za-z]):/.exec(p ?? "")?.[1].toUpperCase() ?? null;

export default function FolderChooser({ open, onClose, onChoose, start }: { open: boolean; onClose: () => void; onChoose: (path: string) => void; start?: string | null }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);

  const load = useCallback(async (dir: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backups/folders${dir ? `?path=${encodeURIComponent(dir)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open this folder");
      setListing(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Opens at the current backup folder when it still exists, otherwise at the list of drives (the screen mounts the
  // chooser afresh each time it is opened, so nothing from last time is left over)
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = start ? await fetch(`/api/backups/folders?path=${encodeURIComponent(start)}`).catch(() => null) : null;
      if (res?.ok) setListing(await res.json());
      else await load(null);
    })();
  }, [open, start, load]);

  const makeFolder = async () => {
    if (!listing?.path || !newName?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backups/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent: listing.path, name: newName }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not make the folder");
      setNewName(null);
      await load(data.path); // open the new folder, ready to use
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  const here = listing?.path ?? null;
  const sameDrive = !!here && !!listing?.dataDrive && driveOf(here) === listing.dataDrive;
  const crumbs = here ? here.split(/[\\/]/).filter(Boolean).map((part, i, all) => ({ name: part, path: all.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : "") })) : [];

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Choose the backup folder</DialogTitle>
        <DialogDescription>Click a drive, then the folders inside it. A different drive from your data, or a USB disk, is safest.</DialogDescription>
      </DialogHeader>

      <nav aria-label="Folder path" className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => void load(null)}>This PC</button>
        {crumbs.map((c) => (
          <span key={c.path} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => void load(c.path)}>{c.name}</button>
          </span>
        ))}
      </nav>

      <div className="h-64 overflow-y-auto rounded-md border" aria-busy={loading}>
        {loading && <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Opening…</div>}
        {!loading && listing && (
          <ul className="divide-y">
            {listing.parent && (
              <li><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => void load(listing.parent)}><Undo2 className="h-4 w-4 text-muted-foreground" aria-hidden />Up one level</button></li>
            )}
            {listing.folders.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No folders here. Use this folder, or make a new one.</li>}
            {listing.folders.map((f) => (
              <li key={f.path}>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => void load(f.path)}>
                  {listing.path ? <Folder className="h-4 w-4 text-amber-500" aria-hidden /> : <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  <span className="truncate">{listing.path ? f.name : `${f.name} drive`}</span>
                  {!listing.path && listing.dataDrive && driveOf(f.path) === listing.dataDrive && <span className="ml-auto text-xs text-muted-foreground">your data is on this drive</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {sameDrive && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Your business data is on this same drive. If the drive fails, the backups go with it: choose another drive or a USB disk if you can.
        </p>
      )}

      {here && newName !== null && (
        <div className="mt-3 flex gap-2">
          <Input autoFocus aria-label="New folder name" placeholder="e.g. PakistanCRM-Backups" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void makeFolder(); }} />
          <Button type="button" disabled={loading || !newName.trim()} onClick={() => void makeFolder()}>Make folder</Button>
        </div>
      )}

      <DialogFooter className="flex-wrap">
        {here && newName === null && <Button type="button" variant="outline" className="mr-auto" onClick={() => setNewName("PakistanCRM-Backups")}><FolderPlus className="mr-1 h-4 w-4" aria-hidden />New folder</Button>}
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!here || loading} onClick={() => here && onChoose(here)}>{here ? "Use this folder" : "Open a drive first"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
