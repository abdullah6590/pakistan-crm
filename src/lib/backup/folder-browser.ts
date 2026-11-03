// src/lib/backup/folder-browser.ts - The folder chooser shown inside the Backups page: drives, the folders inside a
// folder (names only, never files) and "New folder". Used instead of the Windows folder window, which a background
// server cannot bring in front of the browser.
import fs from "node:fs";
import path from "node:path";
import { BackupError } from "./service";

/** Folders Windows keeps for itself; never offered as backup places. */
const HIDDEN = new Set(["$recycle.bin", "system volume information", "config.msi", "recovery", "$windows.~bt", "$windows.~ws", "msocache"]);

export interface FolderListing { path: string | null; parent: string | null; folders: { name: string; path: string }[] }

/** Drives that exist on this computer (C:\, D:\, ...). A: and B: are skipped (old floppy letters can stall). */
export function listDrives(): FolderListing {
  if (process.platform !== "win32") return { path: null, parent: null, folders: [{ name: "/", path: "/" }] };
  const folders = [];
  for (let c = "C".charCodeAt(0); c <= "Z".charCodeAt(0); c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try { if (fs.existsSync(root)) folders.push({ name: `${String.fromCharCode(c)}:`, path: root }); } catch { /* not ready (empty card reader) */ }
  }
  return { path: null, parent: null, folders };
}

/** The folders directly inside `dir`, sorted by name. */
export function listFolders(dir: string): FolderListing {
  if (!path.isAbsolute(dir)) throw new BackupError("Choose a full folder path");
  const full = path.resolve(dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(full, { withFileTypes: true });
  } catch {
    throw new BackupError("This folder cannot be opened");
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !HIDDEN.has(e.name.toLowerCase()))
    .map((e) => ({ name: e.name, path: path.join(full, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const up = path.dirname(full);
  return { path: full, parent: up === full ? null : up, folders };
}

/** Makes one new folder inside `parent` and returns its path. */
export function createFolder(parent: string, name: string): string {
  const clean = name.trim();
  if (!clean || clean === "." || clean === ".." || clean.length > 100 || /[<>:"/\\|?*\u0000-\u001f]/.test(clean) || /[. ]$/.test(clean)) {
    throw new BackupError("Use a simple folder name without \\ / : * ? \" < > |");
  }
  if (!path.isAbsolute(parent) || !fs.existsSync(parent)) throw new BackupError("Open a folder first");
  const target = path.join(path.resolve(parent), clean);
  if (fs.existsSync(target)) throw new BackupError("A folder with that name is already there");
  fs.mkdirSync(target);
  return target;
}

/** The drive letter of a Windows path ("C"), or null elsewhere. */
export function driveOf(p: string | null | undefined): string | null {
  const m = /^([A-Za-z]):/.exec(p ?? "");
  return m ? m[1].toUpperCase() : null;
}
