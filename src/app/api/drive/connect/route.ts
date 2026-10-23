// src/app/api/drive/connect/route.ts - Start Google's consent flow; POST with {action:"disconnect"} removes access.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { startAuthorization, disconnectDrive, DriveError } from "@/lib/backup/drive";

/** Where Google sends the user back: this computer (desktop: http://127.0.0.1:<port>) or the public server URL. */
function redirectUri(request: NextRequest) {
  const base = process.env.CRM_PUBLIC_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${base}/api/drive/callback`;
}

export async function POST(request: NextRequest) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.action === "disconnect") {
      const r = await disconnectDrive(prisma);
      await prisma.auditLog.create({ data: { entity: "DriveConnection", entityId: "local", action: "DISCONNECT", userId: auth.user.id, after: JSON.stringify(r) } });
      return NextResponse.json(r);
    }
    return NextResponse.json({ authUrl: await startAuthorization(prisma, { redirectUri: redirectUri(request), userId: auth.user.id }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof DriveError ? 400 : 500 });
  }
}
