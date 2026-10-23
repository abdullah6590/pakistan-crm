"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderOpen, HardDrive, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Status {
  scope: string;
  settings: { enabled: boolean; directory: string | null; dailyTime: string; frequentMinutes: number; keepDaily: number; keepFrequent: number; passphraseSet: boolean };
  lastSuccess: { at: string; file: string; sizeBytes: number; type: string } | null;
  lastError: { at: string; error: string } | null;
  runs: { id: string; type: string; status: string; trigger: string; file: string | null; sizeBytes: number | null; error: string | null; startedAt: string; uploadStatus: string | null; uploadError: string | null }[];
}

const mb = (n: number | null) => (n === null ? "-" : `${(n / 1048576).toFixed(1)} MB`);
const TRIGGER: Record<string, string> = { SCHEDULE: "scheduled", MISSED_AT_STARTUP: "missed — run at start-up", USER: "manual", SYSTEM: "system" };

interface Drive {
  configured: boolean; status: string; accountEmail: string | null; folderName: string | null; folderSet: boolean; uploadFrequent: boolean;
  keepRemote: number; lastError: string | null; storage: { limit: string; used: string } | null; lastUpload: { at: string; fileId: string | null } | null; waiting: number;
}

export default function BackupsClient({ status, drive, notice }: { status: Status; drive: Drive; notice: Record<string, string | undefined> }) {
  const router = useRouter();
  const [form, setForm] = useState({
    enabled: status.settings.enabled, directory: status.settings.directory ?? "", dailyTime: status.settings.dailyTime,
    frequentMinutes: status.settings.frequentMinutes, keepDaily: status.settings.keepDaily, keepFrequent: status.settings.keepFrequent,
  });
  const [pass, setPass] = useState({ passphrase: "", passphraseConfirm: "" });
  const [busy, setBusy] = useState(false);
  const [folderName, setFolderName] = useState(drive.folderName ?? "Pakistan CRM Backups");

  async function send(url: string, method: string, body?: unknown, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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

  async function choose() {
    const data = await send("/api/backups/pick-folder", "POST");
    if (data?.directory) setForm((f) => ({ ...f, directory: data.directory }));
  }

  async function connectDrive() {
    const data = await send("/api/drive/connect", "POST", {});
    if (data?.authUrl) window.location.href = data.authUrl; // Google's own sign-in and consent page
  }

  return (
    <div className="space-y-4">
      {notice.drive === "connected" && <div className="rounded-md border border-green-300 bg-green-50 p-2 text-sm text-green-900">Google Drive connected. Choose or confirm the backup folder below.</div>}
      {notice.drive === "error" && <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">Google Drive was not connected: {notice.message}</div>}
      <Card>
        <CardContent className="flex flex-wrap gap-6 p-4 text-sm">
          <div><b>Backup history:</b> {status.scope}</div>
          <div><b>Last successful backup:</b> {status.lastSuccess ? `${new Date(status.lastSuccess.at).toLocaleString()} · ${mb(status.lastSuccess.sizeBytes)}` : "none yet"}</div>
          {status.lastSuccess && <div className="break-all"><b>Location:</b> {status.lastSuccess.file}</div>}
          {status.lastError && <div className="text-destructive"><b>Last attempt failed:</b> {status.lastError.error}</div>}
          <Button className="ml-auto" size="sm" disabled={busy} onClick={() => send("/api/backups", "POST", undefined, "Backup created and verified")}><HardDrive className="mr-1 h-4 w-4" />Back up now</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1 md:col-span-3">
            <Label>Backup folder</Label>
            <div className="flex gap-2">
              <Input value={form.directory} placeholder="e.g. E:\CRM Backups (another drive or a USB disk is best)" onChange={(e) => setForm({ ...form, directory: e.target.value })} />
              <Button type="button" variant="outline" disabled={busy} onClick={choose}><FolderOpen className="mr-1 h-4 w-4" />Choose folder…</Button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Automatic backups on</label>
          <div className="space-y-1"><Label>Daily backup time</Label><Input type="time" value={form.dailyTime} onChange={(e) => setForm({ ...form, dailyTime: e.target.value })} /></div>
          <div className="space-y-1"><Label>Extra backup while working (minutes; 0 = off)</Label><Input type="number" min={0} value={form.frequentMinutes} onChange={(e) => setForm({ ...form, frequentMinutes: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label>Keep daily backups</Label><Input type="number" min={1} value={form.keepDaily} onChange={(e) => setForm({ ...form, keepDaily: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label>Keep extra backups</Label><Input type="number" min={0} value={form.keepFrequent} onChange={(e) => setForm({ ...form, keepFrequent: Number(e.target.value) })} /></div>
          <p className="text-xs text-muted-foreground md:col-span-3">If the computer is off at the daily time, the backup runs as soon as the application starts. The newest valid backup is never deleted by the clean-up.</p>
          <div className="md:col-span-3"><Button disabled={busy} onClick={() => send("/api/backups/settings", "PUT", form, "Settings saved")}><Save className="mr-1 h-4 w-4" />Save settings</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Backup passphrase {status.settings.passphraseSet ? <Badge className="ml-2">set</Badge> : <Badge variant="destructive" className="ml-2">not set</Badge>}</CardTitle>
          <p className="text-sm text-muted-foreground">Backups are encrypted with this passphrase. Write it down and keep it somewhere safe: without it, no backup can be restored — not even by the developer.</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input type="password" placeholder="New passphrase (12+ characters)" value={pass.passphrase} onChange={(e) => setPass({ ...pass, passphrase: e.target.value })} />
          <Input type="password" placeholder="Repeat passphrase" value={pass.passphraseConfirm} onChange={(e) => setPass({ ...pass, passphraseConfirm: e.target.value })} />
          <Button disabled={busy || pass.passphrase.length < 12} onClick={async () => { if (await send("/api/backups/settings", "PUT", pass, "Passphrase saved")) setPass({ passphrase: "", passphraseConfirm: "" }); }}>Save passphrase</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Google Drive{" "}
            <Badge variant={drive.status === "CONNECTED" ? "default" : drive.status === "REVOKED" ? "destructive" : "secondary"}>
              {drive.status === "CONNECTED" ? `connected · ${drive.accountEmail ?? ""}` : drive.status === "REVOKED" ? "access removed — reconnect" : drive.status === "PENDING" ? "waiting for Google approval" : "not connected"}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">Encrypted backups are copied to your own Google Drive. You sign in on Google&apos;s page; this application never sees your Google password and can only see the files it creates.</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!drive.configured && <p className="text-amber-700">Google Drive is not set up for this installation yet (owner setup step G in the launch guide).</p>}
          {drive.lastError && <p className="text-destructive">{drive.lastError}</p>}
          <div className="flex flex-wrap gap-4">
            <span><b>Last verified upload:</b> {drive.lastUpload ? new Date(drive.lastUpload.at).toLocaleString() : "none yet"}</span>
            <span><b>Waiting to upload:</b> {drive.waiting}</span>
            {drive.storage && <span><b>Drive space used:</b> {mb(Number(drive.storage.used))} of {mb(Number(drive.storage.limit))}</span>}
          </div>
          {drive.status === "CONNECTED" ? (
            <div className="grid gap-2 md:grid-cols-4">
              <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} />
              <Button variant="outline" disabled={busy} onClick={() => send("/api/drive", "POST", { action: "folder", folderName }, drive.folderSet ? "Folder updated" : "Folder created on Google Drive")}>{drive.folderSet ? "Rename folder" : "Create backup folder"}</Button>
              <Button disabled={busy || !drive.folderSet} onClick={() => send("/api/drive", "POST", { action: "upload-now" }, "Upload finished")}>Upload now</Button>
              <Button variant="ghost" disabled={busy} onClick={() => send("/api/drive/connect", "POST", { action: "disconnect" }, "Google Drive disconnected")}>Disconnect</Button>
              <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" defaultChecked={drive.uploadFrequent} onChange={(e) => send("/api/drive", "POST", { action: "settings", uploadFrequent: e.target.checked }, "Saved")} />Also upload the extra (hourly) backups</label>
            </div>
          ) : (
            <Button disabled={busy || !drive.configured} onClick={connectDrive}>Connect Google Drive</Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {status.runs.length === 0 && <p className="text-muted-foreground">No backups yet.</p>}
          {status.runs.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-b py-1">
              <span>{new Date(r.startedAt).toLocaleString()}</span>
              <Badge variant="outline">{r.type.toLowerCase()}</Badge>
              <span className="text-muted-foreground">{TRIGGER[r.trigger] ?? r.trigger}</span>
              <Badge variant={r.status === "VERIFIED" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>{r.status === "VERIFIED" ? "verified" : r.status.toLowerCase()}</Badge>
              <span>{mb(r.sizeBytes)}</span>
              {r.uploadStatus && <Badge variant={r.uploadStatus === "UPLOADED" ? "default" : "secondary"}>Google Drive: {r.uploadStatus.toLowerCase()}</Badge>}
              {r.error && <span className="text-destructive">{r.error}</span>}
              {r.uploadError && <span className="text-destructive">{r.uploadError}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
