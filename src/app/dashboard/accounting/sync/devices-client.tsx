"use client";

// The main server's list of the business's computers and office servers (Report 25 L-4, Report 23 §4.3):
// register (the secret is shown once), revoke, and move a failed office server's computers elsewhere.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Monitor, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Device { id: string; code: string; name: string; role: string; hubId: string | null; status: string; lastSeenAt: string | null }

export default function DevicesClient({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", role: "DEVICE", hubId: "" });
  const [issued, setIssued] = useState<{ code: string; id: string; secret: string; tenantId: string } | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const hubs = devices.filter((d) => d.role === "HUB" && d.status === "ACTIVE");
  const name = (id: string | null) => devices.find((d) => d.id === id)?.name ?? "main server";

  async function send(url: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(ok);
      router.refresh();
      return data;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    const data = await send("/api/sync/devices", { name: form.name, role: form.role, ...(form.role === "DEVICE" && form.hubId ? { hubId: form.hubId } : {}) }, "Registered");
    if (data?.secret) {
      setIssued({ code: data.device.code, id: data.device.id, secret: data.secret, tenantId: data.tenantId });
      setForm({ name: "", role: "DEVICE", hubId: "" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Computers and office servers</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Counter PC" /></div>
          <div>
            <Label>Type</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="DEVICE">Desktop</option>
              <option value="HUB">Office server</option>
            </select>
          </div>
          {form.role === "DEVICE" && (
            <div>
              <Label>Connects through</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2" value={form.hubId} onChange={(e) => setForm({ ...form, hubId: e.target.value })}>
                <option value="">Main server directly</option>
                {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
              </select>
            </div>
          )}
          <div className="flex items-end"><Button disabled={busy || !form.name.trim()} onClick={register}>Register</Button></div>
        </div>

        {issued && (
          <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <div><b>Shown once.</b> Enter these on {issued.code} only (Report 25 §9), then close this message. They are not stored here in readable form.</div>
            <div className="break-all font-mono text-xs">CRM_DEVICE_ID={issued.id}<br />CRM_DEVICE_CODE={issued.code}<br />CRM_DEVICE_SECRET={issued.secret}<br />CRM_TENANT_ID={issued.tenantId}</div>
            <Button size="sm" variant="outline" onClick={() => setIssued(null)}>I have copied them</Button>
          </div>
        )}

        <div>
          {devices.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 border-b py-2">
              {d.role === "HUB" ? <Server className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              <span className="font-medium">{d.code}</span>
              <span>{d.name}</span>
              {d.role === "DEVICE" && <span className="text-muted-foreground">via {name(d.hubId)}</span>}
              <Badge variant={d.status === "ACTIVE" ? "default" : "destructive"}>{d.status.toLowerCase()}</Badge>
              <span className="text-muted-foreground">{d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "never connected"}</span>
              <div className="ml-auto flex items-center gap-2">
                {d.role === "HUB" && devices.some((x) => x.hubId === d.id) && (
                  <>
                    <select className="h-8 rounded-md border bg-background px-2" value={moveTo[d.id] ?? ""} onChange={(e) => setMoveTo({ ...moveTo, [d.id]: e.target.value })}>
                      <option value="">Main server directly</option>
                      {hubs.filter((h) => h.id !== d.id).map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                    </select>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => send(`/api/sync/devices/${d.id}`, { action: "move-devices", toHubId: moveTo[d.id] || null }, "Computers moved")}>Move its computers</Button>
                  </>
                )}
                {d.status === "ACTIVE" && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm(`Stop ${d.code} from syncing? Nothing on that computer is erased.`)) void send(`/api/sync/devices/${d.id}`, { action: "revoke" }, "Access revoked"); }}>Revoke</Button>
                )}
              </div>
            </div>
          ))}
          {devices.length === 0 && <div className="text-muted-foreground">No computers registered yet.</div>}
        </div>
      </CardContent>
    </Card>
  );
}
