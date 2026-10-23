// src/app/api/sync/snapshot/route.ts - Full consistent copy for a new or rebuilt replica (Report 21 §4.1).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDevice } from "@/lib/sync/route-helpers";
import { snapshot } from "@/lib/sync/server";

export async function GET(request: Request) {
  return withDevice(request, async () => NextResponse.json(await snapshot(prisma)));
}
