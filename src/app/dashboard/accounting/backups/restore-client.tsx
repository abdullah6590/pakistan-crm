"use client";

// Restore from a backup (Report 23). Step 1 only checks and recovers into a separate copy; replacing the live data
// needs the typed phrase, takes a safety backup first, and happens when the application next starts.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, LifeBuoy, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Sources {
  local: { backupId: string; type: string; at: string; file: string; sizeBytes: number | null }[];
  remote: { fileId: string; name: string; size: number; createdTime: string; backupId: string; scope: string }[];
  remoteError: string | null;
  pending: Record<string, string> | null;
  log: Record<string, unknown>[];
}

interface Plan {
  recoveryId: string;
  manifest: { backupId: string; tenantName: string; scope: string; type: string; createdAt: string; appVersion: string; schemaVersion: string };
  schemaAction: string;
  checks: { integrity: string; countsMatch: boolean; reconciliationErrors: string[] };
  covered: Record<string, number>;
  current: Record<string, number> | null;
  wouldLose: string[];
  pendingInBackup: number;
  confirmationPhrase: string;
}

const EVENT: Record<string, string> = {
  PREPARED: "Checked and recovered to a separate copy", PREPARE_FAILED: "Check failed", STAGED: "Replacement confirmed (waiting for restart)",
  APPLIED: "Restored at start-up", FAILED: "Restore at start-up failed; data unchanged", ROLLBACK_FAILED: "Restore failed and needs attention",
  CANCELLED: "Waiting restore cancelled", RESCUED: "Unsent entries rescued", DISCARDED: "Recovered copy removed",
};

export default function RestoreClient({ sources, role }: { sources: Sources; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [file, setFile] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [phrase, setPhrase] = useState("");

  async function post(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/backups/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (ok) toast.success(ok);
      router.refresh();
      return data;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function prepare(source: Record<string, string>) {
    setPlan(null);
    setPhrase("");
    const data = await post({ action: "prepare", ...source, ...(passphrase ? { passphrase } : {}) }, "Backup checked and recovered to a separate copy");
    if (data?.plan) setPlan(data.plan);
  }

  const canReplace = plan && plan.checks.integrity === "ok" && plan.checks.reconciliationErrors.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><LifeBuoy className="h-4 w-4" />Restore</CardTitle>
        <p className="text-sm text-muted-foreground">Choosing a backup only checks it and recovers it into a separate copy. Nothing you use now changes until you confirm below.</p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {sources.pending && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <ShieldAlert className="h-4 w-4" />
            <span>A restore of backup {sources.pending.backupCreatedAt ? new Date(sources.pending.backupCreatedAt).toLocaleString() : sources.pending.backupId} is confirmed. <b>Close and start the application again</b> to apply it. A safety backup of the current data was taken.</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: "cancel" }, "Restore cancelled; nothing was changed")}>Cancel restore</Button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Backup passphrase (leave empty to use the one saved on this computer)</Label><Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" /></div>
          <div>
            <Label>Or a backup file from a USB disk or another computer (full path to a .pkbk file)</Label>
            <div className="flex gap-2"><Input value={file} onChange={(e) => setFile(e.target.value)} placeholder="E:\Backups\...\backup.pkbk" /><Button variant="outline" disabled={busy || !file} onClick={() => prepare({ file })}>Check</Button></div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 font-medium">On this computer</div>
            {sources.local.length === 0 && <div className="text-muted-foreground">No verified backups here.</div>}
            {sources.local.slice(0, 10).map((b) => (
              <div key={b.backupId} className="flex items-center justify-between border-b py-1">
                <span>{new Date(b.at).toLocaleString()} <Badge variant="outline" className="ml-1">{b.type.toLowerCase().replace("_", "-")}</Badge></span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => prepare({ backupId: b.backupId })}>Check</Button>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 font-medium">On Google Drive (all computers of this business)</div>
            {sources.remoteError && <div className="text-destructive">{sources.remoteError}</div>}
            {!sources.remoteError && sources.remote.length === 0 && <div className="text-muted-foreground">None, or Google Drive is not connected.</div>}
            {sources.remote.slice(0, 10).map((b) => (
              <div key={b.fileId} className="flex items-center justify-between border-b py-1">
                <span>{new Date(b.createdTime).toLocaleString()} <Badge variant="outline" className="ml-1">{b.scope}</Badge></span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => prepare({ driveFileId: b.fileId })}>Check</Button>
              </div>
            ))}
          </div>
        </div>

        {plan && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="font-medium">Backup of {plan.manifest.tenantName} · {plan.manifest.scope} · {new Date(plan.manifest.createdAt).toLocaleString()}</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={plan.checks.integrity === "ok" ? "default" : "destructive"}>integrity {plan.checks.integrity}</Badge>
              <Badge variant={plan.checks.countsMatch ? "default" : "destructive"}>{plan.checks.countsMatch ? "record counts match" : "record counts differ"}</Badge>
              <Badge variant={plan.checks.reconciliationErrors.length ? "destructive" : "default"}>{plan.checks.reconciliationErrors.length ? "accounting errors" : "books balance"}</Badge>
              <Badge variant="outline">{plan.schemaAction === "UPGRADED" ? "upgraded to this version (in the copy)" : "same version"}</Badge>
              {plan.pendingInBackup > 0 && <Badge variant="secondary">{plan.pendingInBackup} unsent entries in it</Badge>}
            </div>
            {plan.checks.reconciliationErrors.map((e) => <div key={e} className="text-destructive">{e}</div>)}
            <table className="text-xs">
              <thead><tr><th className="pr-4 text-left">Records</th><th className="pr-4 text-right">In backup</th><th className="text-right">Now</th></tr></thead>
              <tbody>
                {Object.entries(plan.covered).map(([t, n]) => <tr key={t}><td className="pr-4">{t.replace(/_/g, " ")}</td><td className="pr-4 text-right">{n}</td><td className="text-right">{plan.current?.[t] ?? "-"}</td></tr>)}
              </tbody>
            </table>
            {plan.wouldLose.length > 0 && <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-900"><b>Replacing would remove:</b> {plan.wouldLose.join("; ")}. They stay in the safety backup and in the previous database file, which is kept.</div>}

            <div className="flex flex-wrap gap-2">
              {role !== "cloud" && plan.pendingInBackup > 0 && (
                <Button variant="outline" disabled={busy} onClick={() => post({ action: "rescue", recoveryId: plan.recoveryId }, "Unsent entries queued on this computer; they will be sent once")}>
                  <History className="mr-1 h-4 w-4" />Rescue unsent entries onto this computer
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={async () => { if (await post({ action: "discard", recoveryId: plan.recoveryId }, "Recovered copy removed")) setPlan(null); }}>Remove the recovered copy</Button>
            </div>

            {canReplace && (
              <div className="space-y-2 rounded-md border border-red-300 p-3">
                <div className="font-medium text-red-900">Replace the data on this computer with this backup</div>
                <div className="text-muted-foreground">A safety backup of the current data is taken first. User accounts, registered computers and backup settings changed since the backup are kept. Other computers will resend entries this backup does not have. To confirm, type: <code className="rounded bg-muted px-1">{plan.confirmationPhrase}</code></div>
                <div className="flex gap-2">
                  <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
                  <Button variant="destructive" disabled={busy || phrase.trim() !== plan.confirmationPhrase} onClick={async () => { if (await post({ action: "confirm", recoveryId: plan.recoveryId, confirmation: phrase }, "Confirmed. Restart the application to apply it.")) setPlan(null); }}>Replace at next start</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {sources.log.length > 0 && (
          <div>
            <div className="mb-1 font-medium">Restore log</div>
            {sources.log.slice(0, 8).map((e, i) => (
              <div key={i} className="flex gap-3 border-b py-1 text-xs">
                <span className="text-muted-foreground">{new Date(String(e.at)).toLocaleString()}</span>
                <span>{EVENT[String(e.event)] ?? String(e.event)}</span>
                {e.error ? <span className="text-destructive">{String(e.error)}</span> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
