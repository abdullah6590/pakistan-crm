// Test helper: a small local imitation of Google's OAuth and Drive v3 endpoints used by drive.ts.
// It enforces PKCE, labels files with appProperties, supports resumable uploads with Content-Range, and can be
// told to drop a connection mid-upload, report a full Drive, revoke a token, or corrupt the stored copy.
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeFile { id: string; name: string; parents: string[]; appProperties: Record<string, string>; mimeType?: string; data: Buffer; createdTime: string; trashed: boolean }

export function startFakeGoogle() {
  const state = {
    codes: new Map<string, string>(), // code -> code_challenge
    refresh: new Set<string>(),
    access: new Set<string>(),
    files: new Map<string, FakeFile>(),
    sessions: new Map<string, { meta: Partial<FakeFile>; size: number; received: Buffer }>(),
    dropAfterOneChunk: false,
    quotaFull: false,
    corrupt: false,
    down: false,
    revoked: [] as string[],
    resumeQueries: 0,
  };
  const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const authed = (req: http.IncomingMessage) => state.access.has((req.headers.authorization ?? "").replace("Bearer ", ""));
  const meta = (f: FakeFile) => ({ id: f.id, name: f.name, md5Checksum: crypto.createHash("md5").update(f.data).digest("hex"), size: String(f.data.length), createdTime: f.createdTime, trashed: f.trashed, appProperties: f.appProperties });

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, "http://x");
    const p = url.pathname;
    if (state.down && p !== "/__control") return req.socket.destroy();

    // Consent page: behaves as if the owner signed in and pressed "Allow", redirecting with a PKCE-bound code
    if (p === "/auth") {
      const code = `code-${crypto.randomUUID()}`;
      state.codes.set(code, url.searchParams.get("code_challenge") ?? "");
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    // Test-only controls (this imitation server is never used outside tests)
    if (p === "/__control") {
      Object.assign(state, JSON.parse(body.toString() || "{}"));
      return json(res, 200, { ok: true });
    }
    if (p === "/__files") return json(res, 200, { files: [...state.files.values()].filter((f) => !f.mimeType).map((f) => ({ ...meta(f), appProperties: f.appProperties })) });
    if (p === "/token") {
      const f = new URLSearchParams(body.toString());
      if (f.get("grant_type") === "authorization_code") {
        const challenge = state.codes.get(f.get("code") ?? "");
        const derived = crypto.createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
        if (!challenge || challenge !== derived) return json(res, 400, { error: "invalid_grant" });
        state.codes.delete(f.get("code")!);
        const rt = `rt-${crypto.randomUUID()}`;
        const at = `at-${crypto.randomUUID()}`;
        state.refresh.add(rt);
        state.access.add(at);
        return json(res, 200, { access_token: at, refresh_token: rt, expires_in: 3600 });
      }
      if (f.get("grant_type") === "refresh_token") {
        if (!state.refresh.has(f.get("refresh_token") ?? "")) return json(res, 400, { error: "invalid_grant" });
        const at = `at-${crypto.randomUUID()}`;
        state.access.add(at);
        return json(res, 200, { access_token: at, expires_in: 3600 });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (p === "/revoke") {
      const t = new URLSearchParams(body.toString()).get("token") ?? "";
      state.revoked.push(t);
      state.refresh.delete(t);
      return json(res, 200, {});
    }
    if (!authed(req)) return json(res, 401, { error: { message: "unauthenticated" } });

    if (p === "/drive/v3/about") return json(res, 200, { user: { emailAddress: "owner@business.example" }, storageQuota: { limit: "16106127360", usage: "1024" } });
    if (p === "/drive/v3/files" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const conds = [...q.matchAll(/key='(\w+)' and value='([^']*)'/g)].map((m) => [m[1], m[2]]);
      let list = [...state.files.values()].filter((f) => !f.trashed && conds.every(([k, v]) => f.appProperties[k] === v));
      if ((url.searchParams.get("orderBy") ?? "").startsWith("createdTime desc")) list = list.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return json(res, 200, { files: list.map(meta) });
    }
    if (p === "/drive/v3/files" && req.method === "POST") {
      const m = JSON.parse(body.toString());
      const id = `folder-${crypto.randomUUID().slice(0, 8)}`;
      state.files.set(id, { id, name: m.name, parents: [], appProperties: m.appProperties ?? {}, mimeType: m.mimeType, data: Buffer.alloc(0), createdTime: new Date().toISOString(), trashed: false });
      return json(res, 200, { id });
    }
    const one = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (one) {
      const f = state.files.get(one[1]);
      if (!f) return json(res, 404, { error: { message: "not found", errors: [{ reason: "notFound" }] } });
      if (req.method === "DELETE") { state.files.delete(f.id); res.writeHead(204); return res.end(); }
      if (req.method === "PATCH") { Object.assign(f, JSON.parse(body.toString())); return json(res, 200, meta(f)); }
      if (url.searchParams.get("alt") === "media") { res.writeHead(200, { "Content-Type": "application/octet-stream" }); return res.end(f.data); }
      return json(res, 200, meta(f));
    }
    if (p === "/upload/drive/v3/files" && req.method === "POST") {
      if (state.quotaFull) return json(res, 403, { error: { message: "full", errors: [{ reason: "storageQuotaExceeded" }] } });
      const sid = crypto.randomUUID();
      state.sessions.set(sid, { meta: JSON.parse(body.toString()), size: Number(req.headers["x-upload-content-length"]), received: Buffer.alloc(0) });
      const addr = server.address() as AddressInfo;
      res.writeHead(200, { Location: `http://127.0.0.1:${addr.port}/upload/session/${sid}` });
      return res.end();
    }
    const sess = p.match(/^\/upload\/session\/(.+)$/);
    if (sess) {
      const s = state.sessions.get(sess[1]);
      if (!s) return json(res, 404, { error: { message: "session expired" } });
      const range = String(req.headers["content-range"] ?? "");
      if (range.startsWith("bytes */")) {
        state.resumeQueries++;
        if (s.received.length === s.size) return finish(sess[1]);
        res.writeHead(308, s.received.length ? { Range: `bytes=0-${s.received.length - 1}` } : {});
        return res.end();
      }
      const start = Number(range.match(/bytes (\d+)-/)![1]);
      if (start !== s.received.length) return json(res, 400, { error: { message: "bad offset" } });
      s.received = Buffer.concat([s.received, body]);
      if (state.dropAfterOneChunk) {
        state.dropAfterOneChunk = false;
        return req.socket.destroy(); // the chunk was stored, but the client never hears back
      }
      if (s.received.length < s.size) {
        res.writeHead(308, { Range: `bytes=0-${s.received.length - 1}` });
        return res.end();
      }
      return finish(sess[1]);
    }
    return json(res, 404, { error: { message: `no route ${p}` } });

    function finish(sid: string) {
      const s = state.sessions.get(sid)!;
      const id = `file-${crypto.randomUUID().slice(0, 8)}`;
      const data = state.corrupt ? Buffer.concat([s.received.subarray(0, s.received.length - 1), Buffer.from([s.received[s.received.length - 1] ^ 1])]) : s.received;
      state.files.set(id, { id, name: String(s.meta.name), parents: (s.meta.parents as string[]) ?? [], appProperties: (s.meta.appProperties as Record<string, string>) ?? {}, data, createdTime: new Date().toISOString(), trashed: false });
      state.sessions.delete(sid);
      return json(res, 200, meta(state.files.get(id)!));
    }
  });

  return new Promise<{ base: string; state: typeof state; close: () => Promise<void>; consent: (authUrl: string) => { code: string; state: string } }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({
        base, state,
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
        /** The user signs in at Google and approves: Google redirects back with a code bound to the PKCE challenge. */
        consent: (authUrl: string) => {
          const u = new URL(authUrl);
          const code = `code-${crypto.randomUUID()}`;
          state.codes.set(code, u.searchParams.get("code_challenge")!);
          return { code, state: u.searchParams.get("state")! };
        },
      });
    });
  });
}
