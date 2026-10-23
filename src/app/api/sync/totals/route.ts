// src/app/api/sync/totals/route.ts - Document totals at a change-feed position, for local-vs-central reconciliation.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDevice } from "@/lib/sync/route-helpers";
import { documentTotals } from "@/lib/sync/reconcile";

export async function GET(request: Request) {
  return withDevice(request, async () =>
    prisma.$transaction(async (tx) => {
      const max = (await tx.$queryRawUnsafe(`SELECT COALESCE(MAX(seq), 0) AS m FROM change_log`)) as { m: number | bigint }[];
      return NextResponse.json({ atSeq: Number(max[0].m), totals: await documentTotals(tx as never) });
    }));
}
