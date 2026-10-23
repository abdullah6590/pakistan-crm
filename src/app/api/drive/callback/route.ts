// src/app/api/drive/callback/route.ts - Google redirects here after the owner approves (or refuses) access.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { completeAuthorization } from "@/lib/backup/drive";

export async function GET(request: NextRequest) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  const back = new URL("/dashboard/accounting/backups", request.url);
  if (auth.response) {
    back.searchParams.set("drive", "error");
    back.searchParams.set("message", "Sign in as an administrator to connect Google Drive");
    return NextResponse.redirect(back);
  }
  const q = new URL(request.url).searchParams;
  try {
    await completeAuthorization(prisma, { code: q.get("code"), state: q.get("state"), error: q.get("error") });
    await prisma.auditLog.create({ data: { entity: "DriveConnection", entityId: "local", action: "CONNECT", userId: auth.user.id } });
    back.searchParams.set("drive", "connected");
  } catch (e) {
    back.searchParams.set("drive", "error");
    back.searchParams.set("message", (e as Error).message);
  }
  return NextResponse.redirect(back);
}
