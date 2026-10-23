// src/app/api/drive/route.ts - Google Drive connection status, folder and upload settings (Report 22 §8).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureFolder, DriveError } from "@/lib/backup/drive";
import { driveLabel, driveStatus, uploadsNow } from "@/lib/backup/runtime";

export async function GET() {
  const auth = await authorize("backupLocal", "read");
  if (auth.response) return auth.response;
  return NextResponse.json(await driveStatus());
}

const schema = z.object({
  action: z.enum(["folder", "settings", "upload-now"]),
  folderName: z.string().trim().min(1).max(100).optional(),
  uploadFrequent: z.boolean().optional(),
  keepRemote: z.number().int().min(1).max(365).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.action === "folder") {
      const id = await ensureFolder(prisma, body.folderName ?? "Pakistan CRM Backups", driveLabel().tenantId);
      return NextResponse.json({ folderId: id });
    }
    if (body.action === "settings") {
      await prisma.driveConnection.update({ where: { id: "local" }, data: { uploadFrequent: body.uploadFrequent, keepRemote: body.keepRemote } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ summary: await uploadsNow(new Date(), { retryNow: true }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof DriveError ? 400 : 500 });
  }
}
