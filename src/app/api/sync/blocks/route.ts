// src/app/api/sync/blocks/route.ts - An office server reserves a block of official numbers (Report 21 §12).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nodeRole } from "@/lib/tenancy/config";
import { withDevice } from "@/lib/sync/route-helpers";
import { reserveBlock } from "@/lib/sync/server";

export async function POST(request: Request) {
  if (nodeRole() !== "cloud") return NextResponse.json({ error: "Only the main server reserves numbers" }, { status: 409 });
  return withDevice(request, async (device) => {
    if (device.role !== "HUB") return NextResponse.json({ error: "Only an office server may reserve numbers" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    try {
      const block = await reserveBlock(prisma, device.id, String(body.series ?? ""), Number(body.size));
      return NextResponse.json({ block }, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  });
}
