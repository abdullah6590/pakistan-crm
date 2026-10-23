// src/app/api/health/route.ts - Liveness check for uptime monitoring (Report 26 Phase 9). Public; reveals no data:
// only whether this node can reach its database, its role, and whether a restore is waiting for a restart.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nodeRole, tenancyMode } from "@/lib/tenancy/config";
import { listTenants } from "@/lib/tenancy/registry";
import { pendingRestore } from "@/lib/backup/restore-apply";
import { dbFileFromUrl } from "@/lib/backup/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (tenancyMode() === "multi") await listTenants();
    else await prisma.$queryRawUnsafe("SELECT 1");
    const url = process.env.DATABASE_URL ?? "";
    const restoreWaiting = tenancyMode() !== "multi" && url.startsWith("file:") ? !!pendingRestore(dbFileFromUrl(url)) : false;
    // The desktop shell's random per-launch token, so it knows the answer comes from its own server (not a secret)
    const instance = process.env.CRM_DESKTOP_INSTANCE || undefined;
    return NextResponse.json({ status: "ok", role: nodeRole(), restoreWaiting, instance });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
