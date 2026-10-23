// src/app/api/sync/status/route.ts - This computer's sync status; POST runs a sync cycle now.
import { NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { nodeRole } from "@/lib/tenancy/config";
import { outboxSummary } from "@/lib/sync/outbox";
import { runSyncNow, syncState } from "@/lib/sync/scheduler";

export async function GET() {
  const auth = await authorize("sync", "read");
  if (auth.response) return auth.response;
  if (nodeRole() === "cloud") return NextResponse.json({ role: "cloud", message: "This is the main server; entries post immediately" });
  const cursors = await prisma.syncCursor.findMany();
  return NextResponse.json({
    role: nodeRole(),
    device: { id: process.env.CRM_DEVICE_ID ?? null, code: process.env.CRM_DEVICE_CODE ?? null },
    outbox: await outboxSummary(prisma),
    ...syncState(),
    cursors,
  });
}

export async function POST() {
  const auth = await authorize("sync", "read");
  if (auth.response) return auth.response;
  if (nodeRole() === "cloud") return NextResponse.json({ error: "Nothing to sync on the main server" }, { status: 400 });
  const report = await runSyncNow({ retryNow: true });
  return NextResponse.json({ report, outbox: await outboxSummary(prisma) });
}
