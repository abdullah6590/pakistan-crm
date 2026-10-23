// src/app/api/backups/route.ts - Local backup history and "back up now" (Report 22).
import { NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { backupStatus, runBackup } from "@/lib/backup/runtime";
import { BackupError } from "@/lib/backup/service";

export async function GET() {
  const auth = await authorize("backupLocal", "read");
  if (auth.response) return auth.response;
  return NextResponse.json(await backupStatus());
}

export async function POST() {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  try {
    const r = await runBackup("MANUAL", "USER");
    return NextResponse.json({ backupId: r.backupId, file: r.file, size: r.size }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BackupError ? 400 : 500 });
  }
}
