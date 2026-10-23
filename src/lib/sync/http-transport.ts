// src/lib/sync/http-transport.ts - Device/hub → upstream (cloud or office hub) over HTTPS (Report 21 §5).
import { NetworkError, Transport } from "./worker";
import { SYNC_PROTOCOL } from "./commands";

export interface UpstreamConfig {
  url: string;
  deviceId: string;
  secret: string;
  tenantId: string;
  timeoutMs?: number;
}

/** Configuration supplied by the desktop launcher; the secret comes from DPAPI-protected storage. */
export function upstreamFromEnv(): UpstreamConfig | null {
  const url = process.env.CRM_UPSTREAM_URL;
  const deviceId = process.env.CRM_DEVICE_ID;
  const secret = process.env.CRM_DEVICE_SECRET;
  if (!url || !deviceId || !secret) return null;
  return { url: url.replace(/\/$/, ""), deviceId, secret, tenantId: process.env.CRM_TENANT_ID || "default" };
}

export class UpstreamRefused extends Error {}

export function httpTransport(cfg: UpstreamConfig): Transport {
  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetch(cfg.url + path, {
        method, signal: ctl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Device ${cfg.deviceId}.${cfg.secret}`, "X-CRM-Tenant": cfg.tenantId, "X-CRM-Protocol": String(SYNC_PROTOCOL) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new NetworkError((e as Error).name === "AbortError" ? "the server did not answer in time" : "server unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500) throw new NetworkError(`server error ${res.status}`);
    const data = await res.json().catch(() => null);
    // Authentication or permission problems are not retried blindly: they need an administrator
    if (!res.ok) throw new UpstreamRefused(data?.error ?? `refused (${res.status})`);
    return data;
  };
  return {
    upstreamId: `${cfg.url}#${cfg.tenantId}`,
    push: async (commands) => (await call("POST", "/api/sync/push", { commands })).results,
    pull: async (since) => call("GET", `/api/sync/pull?since=${since}`),
    snapshot: async () => call("GET", "/api/sync/snapshot"),
    reserve: async (series, size) => call("POST", "/api/sync/blocks", { series, size }),
    // Answered only by an office hub; the cloud replies 409 and there is simply no office queue
    office: async () => {
      try {
        return (await call("GET", "/api/sync/office")).entries;
      } catch (e) {
        if (e instanceof UpstreamRefused) return [];
        throw e;
      }
    },
  };
}
