// src/app/dashboard/accounting/sync/page.tsx - This computer's entries waiting for the main server, and sync status.
import { redirect } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { nodeRole } from "@/lib/tenancy/config";
import { outboxSummary } from "@/lib/sync/outbox";
import { syncState } from "@/lib/sync/scheduler";
import { PageHeader } from "@/components/shared/page-header";
import SyncClient from "./sync-client";
import DevicesClient from "./devices-client";

export default async function SyncPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "sync", "read")) redirect("/dashboard/accounting");
  const role = nodeRole();
  if (role === "cloud") {
    return (
      <div className="space-y-6">
        <PageHeader title="Sync" icon={RefreshCw} description="This is the main server. Entries made here post immediately; computers sync with it." />
        {can(user.role, "sync", "delete") && (
          <DevicesClient
            devices={(await prisma.device.findMany({ orderBy: { registeredAt: "asc" } })).map((d) => ({
              id: d.id, code: d.code, name: d.name, role: d.role, hubId: d.hubId, status: d.status, lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
            }))}
          />
        )}
      </div>
    );
  }
  const [entries, summary, cursors] = await Promise.all([
    prisma.outboxCommand.findMany({ orderBy: { seq: "desc" }, take: 300 }),
    outboxSummary(prisma),
    prisma.syncCursor.findMany(),
  ]);
  const state = syncState();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sync"
        icon={RefreshCw}
        description="Entries made on this computer are saved here first and sent to the main server automatically when it can be reached."
      />
      <SyncClient
        role={role}
        deviceCode={process.env.CRM_DEVICE_CODE ?? null}
        canApprove={can(user.role, "stockApproval", "write")}
        userId={user.id}
        isAdmin={user.role === "ADMIN"}
        summary={summary}
        last={state.last}
        lastSuccessAt={state.lastSuccessAt ?? cursors.map((c) => c.updatedAt.toISOString()).sort().pop() ?? null}
        entries={entries.map((e) => ({
          id: e.id, seq: e.seq, type: e.type, status: e.status, provisionalRef: e.provisionalRef, createdById: e.createdById,
          createdAt: e.createdAt.toISOString(), syncedAt: e.syncedAt?.toISOString() ?? null, attempts: e.attempts,
          nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null, lastError: e.lastError, payload: e.payload, preview: e.preview, result: e.result,
        }))}
      />
    </div>
  );
}
