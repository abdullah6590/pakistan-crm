// src/app/api/backups/folders/route.ts - The in-page folder chooser for backups: list drives and folders, make a new
// folder. Administrators only, and only on the computer that runs Pakistan CRM (desktop, office server, or the website
// opened on that same PC): elsewhere it would show the server's folders, so the path is typed instead.
import { NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { nodeRole } from "@/lib/tenancy/config";
import { userRateLimitGuard } from "@/lib/rate-limit";
import { folderPickerAllowed } from "@/lib/backup/picker-access";
import { createFolder, driveOf, listDrives, listFolders } from "@/lib/backup/folder-browser";
import { BackupError, dbFileFromUrl } from "@/lib/backup/service";

/** The drive the business data is on, so the screen can warn about backing up to that same drive. */
const dataDrive = () => {
  try { return driveOf(dbFileFromUrl(process.env.DATABASE_URL || "file:./dev.db")); } catch { return null; }
};

export async function GET(request: Request) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  if (!folderPickerAllowed(request.headers.get("host"), nodeRole())) return NextResponse.json({ error: "Folders can be chosen only on the computer running Pakistan CRM: type the folder path instead" }, { status: 409 });
  const dir = new URL(request.url).searchParams.get("path");
  try {
    return NextResponse.json({ ...(dir ? listFolders(dir) : listDrives()), dataDrive: dataDrive() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BackupError ? 400 : 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  if (!folderPickerAllowed(request.headers.get("host"), nodeRole())) return NextResponse.json({ error: "Folders can be made only on the computer running Pakistan CRM" }, { status: 409 });
  const limited = await userRateLimitGuard(prisma, request, "backupSettings", auth.user.id);
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  try {
    if (typeof body.parent !== "string" || typeof body.name !== "string") throw new BackupError("Open a folder and type a name");
    return NextResponse.json({ path: createFolder(body.parent, body.name) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BackupError ? 400 : 500 });
  }
}
