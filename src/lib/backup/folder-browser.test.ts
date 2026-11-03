import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFolder, driveOf, listDrives, listFolders } from "./folder-browser";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-folder-browser-"));
  for (const d of ["Zeta", "alpha", "$RECYCLE.BIN", "System Volume Information", ".hidden"]) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, "notes.txt"), "a file, never listed");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("in-page folder chooser", () => {
  it("lists only ordinary folders (no files, no Windows system folders), sorted, with the way up", () => {
    const l = listFolders(root);
    expect(l.folders.map((f) => f.name)).toEqual(["alpha", "Zeta"]);
    expect(l.parent).toBe(path.dirname(root));
    expect(l.folders[0].path).toBe(path.join(root, "alpha"));
  });

  it("makes a new folder, and refuses bad or duplicate names", () => {
    expect(createFolder(root, " PakistanCRM-Backups ")).toBe(path.join(root, "PakistanCRM-Backups"));
    expect(fs.statSync(path.join(root, "PakistanCRM-Backups")).isDirectory()).toBe(true);
    expect(() => createFolder(root, "PakistanCRM-Backups")).toThrow(/already there/);
    for (const bad of ["", "..", "a/b", "a\\b", "c:d", "x?", "ends with dot."]) expect(() => createFolder(root, bad)).toThrow();
    expect(() => createFolder("relative", "x")).toThrow();
  });

  it("refuses relative or missing folders", () => {
    expect(() => listFolders("relative\\path")).toThrow(/full folder path/);
    expect(() => listFolders(path.join(root, "does-not-exist"))).toThrow(/cannot be opened/);
  });

  it("knows the drive of a path; on Windows lists the drives that exist", () => {
    expect(driveOf("d:\\pakistan crm\\crm.db")).toBe("D");
    expect(driveOf("/home/x")).toBeNull();
    const drives = listDrives().folders.map((f) => f.name);
    if (process.platform === "win32") expect(drives).toContain("C:");
  });
});
