// src/app/api/sync/pull/route.ts - Change feed for a device or hub replica (Report 21 §4).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDevice } from "@/lib/sync/route-helpers";
import { pullChanges } from "@/lib/sync/server";

export async function GET(request: Request) {
  return withDevice(request, async () => {
    const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
    if (!Number.isInteger(since) || since < 0) return NextResponse.json({ error: "since must be a non-negative integer" }, { status: 400 });
    return NextResponse.json(await pullChanges(prisma, since));
  });
}
