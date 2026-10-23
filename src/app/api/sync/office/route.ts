// src/app/api/sync/office/route.ts - Office hub: entries from all office computers not yet at the cloud (Mode A).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nodeRole } from "@/lib/tenancy/config";
import { withDevice } from "@/lib/sync/route-helpers";
import { officePending } from "@/lib/sync/hub";

export async function GET(request: Request) {
  if (nodeRole() !== "hub") return NextResponse.json({ error: "Only an office server keeps an office queue" }, { status: 409 });
  return withDevice(request, async () => NextResponse.json({ entries: await officePending(prisma) }));
}
