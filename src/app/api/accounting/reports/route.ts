// src/app/api/accounting/reports/route.ts - Trial balance, stock position, press reconciliation, approval queue.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { trialBalance, stockReport, pressReport, pendingApprovals, daybook, profitReport, negativeStockExceptions, kgReport, selfApprovalReport } from "@/lib/accounting/queries";
import { serialize } from "@/lib/accounting/server";
import type { PrismaClient } from "@prisma/client";
import { isAuthority, localDevice } from "@/lib/sync/local";
import { speculate } from "@/lib/sync/outbox";
import { reconcileCentral, reconcileLocal, numberingReport, documentTotals } from "@/lib/sync/reconcile";
import { upstreamFromEnv } from "@/lib/sync/http-transport";

const REPORT_RESOURCE: Record<string, string> = {
  "trial-balance": "ledgers",
  stock: "inventory",
  press: "press",
  approvals: "stockApproval",
  "self-approvals": "stockApproval",
  daybook: "ledgers",
  profit: "reports",
  "negative-stock": "inventory",
  kg: "reports",
  reconcile: "ledgers",
  numbering: "ledgers",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const report = searchParams.get("report") ?? "";
  const resource = REPORT_RESOURCE[report];
  if (!resource) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  const auth = await authorize(resource, "read");
  if (auth.response) return auth.response;

  const to = searchParams.get("to");
  const from = searchParams.get("from");
  const range = { from: from ? new Date(from) : undefined, to: to ? new Date(`${to}T23:59:59.999Z`) : undefined };
  const compute = async (db: PrismaClient): Promise<{ status: number; body: unknown }> => {
    if (report === "trial-balance") return { status: 200, body: await trialBalance(db, range.to) };
    if (report === "stock") return { status: 200, body: await stockReport(db, { locationCode: searchParams.get("location") ?? undefined }) };
    if (report === "approvals") return { status: 200, body: { documents: await pendingApprovals(db) } };
    if (report === "self-approvals") return { status: 200, body: await selfApprovalReport(db, range) };
    if (report === "daybook") return { status: 200, body: await daybook(db, range) };
    if (report === "profit") return { status: 200, body: await profitReport(db, range, searchParams.get("by") === "document" ? "document" : "item") };
    if (report === "negative-stock") return { status: 200, body: await negativeStockExceptions(db) };
    if (report === "kg") return { status: 200, body: { rows: await kgReport(db, range, searchParams.get("side") === "purchase" ? "purchase" : "sale") } };
    if (report === "numbering") return { status: 200, body: { series: await numberingReport(db) } };
    if (report === "reconcile") {
      if (isAuthority()) return { status: 200, body: await reconcileCentral(db) };
      // A desktop or office server compares its copy with its upstream's totals when it can reach it
      const cfg = upstreamFromEnv();
      let central: { atSeq: number; totals: Awaited<ReturnType<typeof documentTotals>> } | undefined;
      let note: string | null = null;
      if (cfg) {
        try {
          const res = await fetch(`${cfg.url}/api/sync/totals`, { headers: { Authorization: `Device ${cfg.deviceId}.${cfg.secret}`, "X-CRM-Tenant": cfg.tenantId }, signal: AbortSignal.timeout(15_000) });
          if (res.ok) central = await res.json();
          else note = `Server totals unavailable (${res.status})`;
        } catch {
          note = "Server not reachable: comparison with central totals skipped";
        }
      }
      return { status: 200, body: { ...(await reconcileLocal(db, central)), totals: await documentTotals(db), note } };
    }
    const pressId = searchParams.get("pressAccountId");
    if (!pressId) return { status: 400, body: { error: "Choose a press" } };
    const result = await pressReport(db, pressId);
    return result ? { status: 200, body: result } : { status: 404, body: { error: "Press not found" } };
  };
  // Phase 5: every report states what it contains. On a desktop or office server, "withPending" adds entries made
  // offline (this computer's and, through an office server, the office's) to the synchronised figures.
  const withPending = searchParams.get("view") === "withPending" && !isAuthority();
  const { status, body } = withPending
    ? await speculate(prisma, localDevice(), (tx) => compute(tx as unknown as PrismaClient))
    : await compute(prisma);
  const view = isAuthority() ? "CENTRAL" : withPending ? "SYNCED_PLUS_PENDING" : "SYNCED_ONLY";
  return NextResponse.json(serialize(status === 200 ? { ...(body as object), view } : body), { status });
}
