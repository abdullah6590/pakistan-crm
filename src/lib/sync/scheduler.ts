// src/lib/sync/scheduler.ts - Background sync loop for devices and hubs (started from src/instrumentation.ts).
// Runs every CRM_SYNC_INTERVAL_MS (default 15 s) and on demand; never two cycles at once.
import { prisma } from "@/lib/prisma";
import { nodeRole } from "@/lib/tenancy/config";
import { httpTransport, upstreamFromEnv } from "./http-transport";
import { syncOnce, SyncReport } from "./worker";
import { hubNumberSeries } from "./hub";

const state = globalThis as unknown as { crmSync?: { running: boolean; timer?: NodeJS.Timeout; last?: SyncReport; lastSuccessAt?: string; hooks: (() => Promise<unknown>)[] } };
state.crmSync ??= { running: false, hooks: [] };

export function syncState() {
  return { last: state.crmSync!.last ?? null, lastSuccessAt: state.crmSync!.lastSuccessAt ?? null, running: state.crmSync!.running };
}

/** Extra work after each cycle (e.g. a hub forwarding its office queue, Phase 4). */
export function afterSync(hook: () => Promise<unknown>) {
  state.crmSync!.hooks.push(hook);
}

export async function runSyncNow(opts: { retryNow?: boolean } = {}): Promise<SyncReport | null> {
  const s = state.crmSync!;
  const cfg = upstreamFromEnv();
  if (!cfg || s.running) return s.last ?? null;
  s.running = true;
  try {
    const report = await syncOnce(prisma, httpTransport(cfg), new Date(), opts);
    s.last = report;
    if (!report.error) s.lastSuccessAt = report.startedAt;
    for (const hook of s.hooks) await hook().catch(() => undefined);
    return report;
  } finally {
    s.running = false;
  }
}

export function startSyncLoop() {
  if (nodeRole() === "cloud" || state.crmSync!.timer) return;
  // Office server with hub numbering enabled: keep its reserved number blocks topped up (Report 21 §12)
  const cfg = upstreamFromEnv();
  const series = nodeRole() === "hub" ? hubNumberSeries() : [];
  if (series.length && cfg) {
    const size = Math.max(10, Number(process.env.CRM_HUB_NUMBER_BLOCK_SIZE) || 100);
    afterSync(async () => {
      const { ensureNumberBlocks } = await import("./hub");
      const requested = await ensureNumberBlocks(prisma, cfg.deviceId, series, size, (s, n) => httpTransport(cfg).reserve!(s, n));
      if (requested.length) await syncOnce(prisma, httpTransport(cfg)); // pull the new blocks
    });
  }
  const every = Math.max(2_000, Number(process.env.CRM_SYNC_INTERVAL_MS) || 15_000);
  state.crmSync!.timer = setInterval(() => void runSyncNow(), every);
  void runSyncNow();
}
