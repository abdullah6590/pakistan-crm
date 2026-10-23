// src/app/api/sync/push/route.ts - A device sends queued commands; each is executed exactly once (Report 21 §3).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDevice } from "@/lib/sync/route-helpers";
import { pushCommands } from "@/lib/sync/server";
import { relayCommands } from "@/lib/sync/hub";
import { nodeRole } from "@/lib/tenancy/config";

export async function POST(request: Request) {
  return withDevice(request, async (device) => {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.commands)) return NextResponse.json({ error: "Send { commands: [...] }" }, { status: 400 });
    try {
      // An office hub relays (never posts); the cloud executes
      const results = nodeRole() === "hub" ? await relayCommands(prisma, device.id, body.commands, process.env.CRM_DEVICE_ID) : await pushCommands(prisma, { id: device.id, role: device.role }, body.commands);
      return NextResponse.json({ results });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  });
}
