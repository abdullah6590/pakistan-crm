// src/lib/backup/drive.ts - Upload encrypted backups to the business's own Google Drive (Report 22 §8).
// OAuth 2.0 authorisation-code flow with PKCE; scope drive.file (the app sees only files it created). The refresh
// token is stored protected (DPAPI on desktops, AES-256-GCM with CRM_TOKEN_KEY on servers). Uploads are resumable,
// labelled with the backup id (no duplicates on retry), and recorded as uploaded only after Google's MD5 and size
// match the local package.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { protectSecret, unprotectSecret, dpapiAvailable } from "@/lib/device/secrets";
import { nodeRole } from "@/lib/tenancy/config";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveConfig {
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  apiBase: string;
  uploadBase: string;
  revokeUrl: string;
  chunkBytes: number;
}

/** Google's endpoints by default; tests point these at a local imitation server. */
export function driveConfig(): DriveConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return null;
  return {
    clientId,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || undefined,
    authUrl: process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    apiBase: process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3",
    uploadBase: process.env.DRIVE_UPLOAD_BASE || "https://www.googleapis.com/upload/drive/v3",
    revokeUrl: process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke",
    chunkBytes: Math.max(256 * 1024, Number(process.env.DRIVE_CHUNK_BYTES) || 8 * 1024 * 1024),
  };
}

export type DriveErrorKind = "NOT_CONFIGURED" | "NOT_CONNECTED" | "AUTH_REVOKED" | "QUOTA" | "PERMISSION" | "NOT_FOUND" | "NETWORK" | "SERVER" | "VERIFY";
export class DriveError extends Error {
  constructor(public kind: DriveErrorKind, message: string) {
    super(message);
  }
}

// ─── Token protection ─────────────────────────────────────────────
function tokenKey(): Buffer {
  const k = process.env.CRM_TOKEN_KEY;
  if (!k) throw new DriveError("NOT_CONFIGURED", "Set CRM_TOKEN_KEY (32-byte key from the secret store) to keep Google tokens on this server");
  const key = /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, "hex") : Buffer.from(k, "base64");
  if (key.length !== 32) throw new DriveError("NOT_CONFIGURED", "CRM_TOKEN_KEY must be 32 bytes (64 hex characters)");
  return key;
}

export async function protectToken(token: string): Promise<string> {
  if (nodeRole() !== "cloud" && dpapiAvailable()) return `dpapi:${await protectSecret(token)}`;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `aes:${iv.toString("base64")}.${ct.toString("base64")}.${c.getAuthTag().toString("base64")}`;
}

export async function unprotectToken(stored: string): Promise<string> {
  if (stored.startsWith("dpapi:")) return unprotectSecret(stored.slice(6));
  const [iv, ct, tag] = stored.slice(4).split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", tokenKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// ─── OAuth ────────────────────────────────────────────────────────
const b64url = (b: Buffer) => b.toString("base64url");

async function connection(db: PrismaClient) {
  return db.driveConnection.findUnique({ where: { id: "local" } });
}

/** Step 1: the URL of Google's own consent screen (the user never gives the app a password). */
export async function startAuthorization(db: PrismaClient, opts: { redirectUri: string; userId: string }) {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("NOT_CONFIGURED", "Google Drive is not set up for this installation (Report 25, step G)");
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(24));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  await db.driveConnection.upsert({
    where: { id: "local" },
    create: { id: "local", status: "PENDING", pkceVerifier: verifier, oauthState: state, redirectUri: opts.redirectUri, connectedById: opts.userId },
    update: { pkceVerifier: verifier, oauthState: state, redirectUri: opts.redirectUri, connectedById: opts.userId, lastError: null },
  });
  const u = new URL(cfg.authUrl);
  u.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: opts.redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent",
    include_granted_scopes: "true", code_challenge: challenge, code_challenge_method: "S256", state,
  }).toString();
  return u.toString();
}

async function tokenRequest(cfg: DriveConfig, body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg.clientId, ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}), ...body }).toString() });
  } catch {
    throw new DriveError("NETWORK", "Google could not be reached");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "invalid_grant") throw new DriveError("AUTH_REVOKED", "Google access was revoked or has expired; connect Google Drive again");
    throw new DriveError(res.status >= 500 ? "SERVER" : "PERMISSION", `Google refused the request (${data.error ?? res.status})`);
  }
  return data as { access_token: string; refresh_token?: string; expires_in?: number };
}

const accessCache = new Map<string, { token: string; until: number }>();

/** Forget the short-lived access token (it is re-obtained from the refresh token on next use). */
export function clearAccessCache() {
  accessCache.clear();
}

/** Step 2: Google redirects back with a code; exchange it (with the PKCE verifier) and keep only the refresh token. */
export async function completeAuthorization(db: PrismaClient, q: { code?: string | null; state?: string | null; error?: string | null }) {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("NOT_CONFIGURED", "Google Drive is not set up for this installation");
  const conn = await connection(db);
  if (!conn?.oauthState || !q.state || q.state !== conn.oauthState) throw new DriveError("PERMISSION", "This authorisation did not start here (state mismatch); try again");
  if (q.error || !q.code) {
    await db.driveConnection.update({ where: { id: "local" }, data: { pkceVerifier: null, oauthState: null, lastError: `Authorisation cancelled (${q.error ?? "no code"})` } });
    throw new DriveError("PERMISSION", "Google Drive access was not granted");
  }
  const t = await tokenRequest(cfg, { grant_type: "authorization_code", code: q.code, redirect_uri: conn.redirectUri ?? "", code_verifier: conn.pkceVerifier ?? "" });
  if (!t.refresh_token) throw new DriveError("PERMISSION", "Google did not return offline access; remove the app in your Google Account and connect again");
  accessCache.set("local", { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
  const about = await api(db, cfg, "GET", "/about?fields=user(emailAddress),storageQuota(limit,usage)", undefined, t.access_token);
  await db.driveConnection.update({
    where: { id: "local" },
    data: {
      status: "CONNECTED", protectedRefreshToken: await protectToken(t.refresh_token), pkceVerifier: null, oauthState: null, lastError: null,
      accountEmail: about.user?.emailAddress ?? null, quotaBytes: about.storageQuota?.limit ?? null, usedBytes: about.storageQuota?.usage ?? null, connectedAt: new Date(),
    },
  });
  // Uploads that were waiting for the owner to reconnect can go now
  await db.backupRun.updateMany({ where: { uploadStatus: "FAILED" }, data: { uploadNextAt: new Date() } });
}

async function accessToken(db: PrismaClient, cfg: DriveConfig): Promise<string> {
  const cached = accessCache.get("local");
  if (cached && cached.until > Date.now()) return cached.token;
  const conn = await connection(db);
  if (!conn || conn.status !== "CONNECTED" || !conn.protectedRefreshToken) throw new DriveError("NOT_CONNECTED", "Google Drive is not connected");
  try {
    const t = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: await unprotectToken(conn.protectedRefreshToken) });
    accessCache.set("local", { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof DriveError && e.kind === "AUTH_REVOKED") {
      await db.driveConnection.update({ where: { id: "local" }, data: { status: "REVOKED", lastError: e.message } });
    }
    throw e;
  }
}

function classify(status: number, body: { error?: { message?: string; errors?: { reason?: string }[] } }): DriveError {
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  if (status === 403 && /storageQuotaExceeded|quotaExceeded/.test(reason)) return new DriveError("QUOTA", "Google Drive is full: free up space or buy more storage, then the upload will continue");
  if (status === 401) return new DriveError("AUTH_REVOKED", "Google access is no longer valid; connect Google Drive again");
  if (status === 403) return new DriveError("PERMISSION", `Google Drive refused access (${reason || "forbidden"})`);
  if (status === 404) return new DriveError("NOT_FOUND", "The backup folder on Google Drive no longer exists");
  if (status === 429 || status >= 500) return new DriveError("SERVER", `Google Drive is busy (${status}); will retry`);
  return new DriveError("SERVER", body?.error?.message ?? `Google Drive error ${status}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(db: PrismaClient, cfg: DriveConfig, method: string, p: string, body?: unknown, token?: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = token ?? (await accessToken(db, cfg));
    let res: Response;
    try {
      res = await fetch(cfg.apiBase + p, { method, headers: { Authorization: `Bearer ${access}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new DriveError("NETWORK", "Google Drive could not be reached");
    }
    if (res.status === 401 && !token && attempt === 0) {
      accessCache.delete("local"); // expired access token: refresh once
      continue;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw classify(res.status, data);
    return data;
  }
}

// ─── Folder ───────────────────────────────────────────────────────
/** The app's own backup folder (drive.file can only use folders the app created). */
export async function ensureFolder(db: PrismaClient, name: string, tenantId: string): Promise<string> {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("NOT_CONFIGURED", "Google Drive is not set up");
  const conn = await connection(db);
  if (conn?.folderId) {
    try {
      const f = await api(db, cfg, "GET", `/files/${conn.folderId}?fields=id,name,trashed`);
      if (!f.trashed) {
        if (f.name !== name) await api(db, cfg, "PATCH", `/files/${conn.folderId}`, { name });
        await db.driveConnection.update({ where: { id: "local" }, data: { folderName: name } });
        return conn.folderId;
      }
    } catch (e) {
      if (!(e instanceof DriveError && e.kind === "NOT_FOUND")) throw e;
    }
  }
  const f = await api(db, cfg, "POST", "/files?fields=id", { name, mimeType: "application/vnd.google-apps.folder", appProperties: { crmFolder: "1", crmTenant: tenantId } });
  await db.driveConnection.update({ where: { id: "local" }, data: { folderId: f.id, folderName: name } });
  return f.id;
}

// ─── Upload ───────────────────────────────────────────────────────
async function md5File(file: string): Promise<string> {
  const h = crypto.createHash("md5");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

function readRange(file: string, start: number, end: number): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(end - start + 1);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Upload one verified backup. Safe to call again after any failure: an existing upload of the same backup is found
 * by its label (no duplicate), and an interrupted upload resumes from the last byte Google confirmed.
 */
export async function uploadBackup(db: PrismaClient, run: { id: string; file: string; uploadSession: string | null }, label: { tenantId: string; scope: string }) {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("NOT_CONFIGURED", "Google Drive is not set up");
  const conn = await connection(db);
  if (!conn || conn.status !== "CONNECTED" || !conn.folderId) throw new DriveError("NOT_CONNECTED", "Connect Google Drive and choose its folder first");
  const size = fs.statSync(run.file).size;
  const md5 = await md5File(run.file);

  // 1. Already there? (e.g. the upload finished but this computer stopped before recording it)
  const q = `appProperties has { key='crmBackupId' and value='${run.id}' } and appProperties has { key='crmTenant' and value='${label.tenantId}' } and trashed=false`;
  const existing = await api(db, cfg, "GET", `/files?q=${encodeURIComponent(q)}&fields=files(id,md5Checksum,size)&spaces=drive`);
  for (const f of existing.files ?? []) {
    if (f.md5Checksum === md5 && Number(f.size) === size) return { fileId: f.id as string, reused: true };
    await api(db, cfg, "DELETE", `/files/${f.id}`); // a damaged earlier attempt is replaced, never kept beside the good copy
  }

  // 2. Resume the session if there is one, otherwise start one
  const access = await accessToken(db, cfg);
  let session = run.uploadSession;
  let offset = 0;
  if (session) {
    try {
      const res = await fetch(session, { method: "PUT", headers: { Authorization: `Bearer ${access}`, "Content-Range": `bytes */${size}` } });
      if (res.status === 308) offset = res.headers.get("range") ? Number(res.headers.get("range")!.split("-")[1]) + 1 : 0;
      else if (res.status === 200 || res.status === 201) return verify(db, cfg, run.id, await res.json(), md5, size);
      else session = null; // expired session: start again
    } catch {
      throw new DriveError("NETWORK", "Google Drive could not be reached");
    }
  }
  if (!session) {
    let res: Response;
    try {
      res = await fetch(`${cfg.uploadBase}/files?uploadType=resumable&fields=id,md5Checksum,size`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(size) },
        body: JSON.stringify({ name: path.basename(run.file), parents: [conn.folderId], appProperties: { crmBackupId: run.id, crmTenant: label.tenantId, crmScope: label.scope } }),
      });
    } catch {
      throw new DriveError("NETWORK", "Google Drive could not be reached");
    }
    if (!res.ok) throw classify(res.status, await res.json().catch(() => ({})));
    session = res.headers.get("location");
    if (!session) throw new DriveError("SERVER", "Google Drive did not start the upload");
    await db.backupRun.update({ where: { id: run.id }, data: { uploadSession: session } });
  }

  // 3. Send the rest in chunks; each confirmed chunk survives an interruption
  while (offset < size) {
    const end = Math.min(offset + cfg.chunkBytes, size) - 1;
    let res: Response;
    try {
      res = await fetch(session, { method: "PUT", headers: { Authorization: `Bearer ${access}`, "Content-Range": `bytes ${offset}-${end}/${size}` }, body: new Uint8Array(readRange(run.file, offset, end)) });
    } catch {
      throw new DriveError("NETWORK", "The upload was interrupted; it will continue from where it stopped");
    }
    if (res.status === 308) {
      offset = res.headers.get("range") ? Number(res.headers.get("range")!.split("-")[1]) + 1 : offset;
      continue;
    }
    if (res.status === 200 || res.status === 201) return verify(db, cfg, run.id, await res.json(), md5, size);
    throw classify(res.status, await res.json().catch(() => ({})));
  }
  throw new DriveError("SERVER", "Upload ended without confirmation");
}

async function verify(db: PrismaClient, cfg: DriveConfig, runId: string, file: { id: string; md5Checksum?: string; size?: string }, md5: string, size: number) {
  if (file.md5Checksum !== md5 || Number(file.size) !== size) {
    await api(db, cfg, "DELETE", `/files/${file.id}`).catch(() => undefined);
    await db.backupRun.update({ where: { id: runId }, data: { uploadSession: null } });
    throw new DriveError("VERIFY", "Google Drive's copy did not match the local backup; it was removed and will be uploaded again");
  }
  return { fileId: file.id, reused: false };
}

/** Keep the newest `keep` backups of this business and computer on Drive; never touch other files. */
export async function pruneRemote(db: PrismaClient, label: { tenantId: string; scope: string }, keep: number) {
  const cfg = driveConfig();
  if (!cfg) return [];
  const q = `appProperties has { key='crmTenant' and value='${label.tenantId}' } and appProperties has { key='crmScope' and value='${label.scope}' } and trashed=false`;
  const list = await api(db, cfg, "GET", `/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,createdTime)&pageSize=1000`);
  const files: { id: string }[] = list.files ?? [];
  const removed = [];
  for (const f of files.slice(Math.max(1, keep))) {
    await api(db, cfg, "DELETE", `/files/${f.id}`);
    removed.push(f.id);
  }
  return removed;
}

// ─── Restore (Report 23) ──────────────────────────────────────────
/** Backups of this business on Drive, from every computer, so a replacement computer can find a failed one's. */
export async function listRemoteBackups(db: PrismaClient, tenantId: string) {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("NOT_CONFIGURED", "Google Drive is not set up");
  const q = `appProperties has { key='crmTenant' and value='${tenantId}' } and trashed=false`;
  const list = await api(db, cfg, "GET", `/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&fields=files(id,name,size,md5Checksum,createdTime,appProperties)&pageSize=1000`);
  return ((list.files ?? []) as { id: string; name: string; size: string; md5Checksum: string; createdTime: string; appProperties?: Record<string, string> }[])
    .filter((f) => f.appProperties?.crmBackupId && f.appProperties.crmTenant === tenantId)
    .map((f) => ({ fileId: f.id, name: f.name, size: Number(f.size), createdTime: f.createdTime, backupId: f.appProperties!.crmBackupId, scope: f.appProperties!.crmScope ?? "" }));
}

/** Download one backup of this business and check it against Google's checksum before it is used. */
export async function downloadRemote(db: PrismaClient, tenantId: string, fileId: string, dst: string) {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("NOT_CONFIGURED", "Google Drive is not set up");
  const f = await api(db, cfg, "GET", `/files/${encodeURIComponent(fileId)}?fields=id,size,md5Checksum,appProperties`);
  if (f.appProperties?.crmTenant !== tenantId || !f.appProperties?.crmBackupId) throw new DriveError("PERMISSION", "That Drive file is not a backup of this business");
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${await accessToken(db, cfg)}` } });
  } catch {
    throw new DriveError("NETWORK", "Google Drive could not be reached");
  }
  if (!res.ok) throw classify(res.status, await res.json().catch(() => ({})));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst + ".partial", Buffer.from(await res.arrayBuffer()));
  if ((await md5File(dst + ".partial")) !== f.md5Checksum || fs.statSync(dst + ".partial").size !== Number(f.size)) {
    fs.rmSync(dst + ".partial", { force: true });
    throw new DriveError("VERIFY", "The downloaded backup did not match Google Drive's copy; try again");
  }
  fs.renameSync(dst + ".partial", dst);
  return { file: dst, backupId: f.appProperties.crmBackupId as string };
}

/** Disconnect: revoke the grant at Google (if reachable) and delete the stored token here in any case. */
export async function disconnectDrive(db: PrismaClient) {
  const cfg = driveConfig();
  const conn = await connection(db);
  let revokedAtGoogle = false;
  if (cfg && conn?.protectedRefreshToken) {
    try {
      const res = await fetch(cfg.revokeUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: await unprotectToken(conn.protectedRefreshToken) }).toString() });
      revokedAtGoogle = res.ok;
    } catch {
      revokedAtGoogle = false;
    }
  }
  accessCache.delete("local");
  if (conn) await db.driveConnection.update({ where: { id: "local" }, data: { status: "REVOKED", protectedRefreshToken: null, lastError: revokedAtGoogle ? null : "Disconnected here; also remove the app under Google Account → Security → Third-party access" } });
  return { revokedAtGoogle };
}

/** After a verified backup: queue it for Drive (daily, manual and pre-restore; frequent ones only if chosen). */
export async function queueUpload(db: PrismaClient, runId: string, type: string) {
  const conn = await connection(db);
  if (!conn || conn.status !== "CONNECTED") return false;
  if (type === "FREQUENT" && !conn.uploadFrequent) return false;
  await db.backupRun.update({ where: { id: runId }, data: { uploadStatus: "QUEUED", uploadNextAt: new Date() } });
  return true;
}

function retryDelay(attempts: number) {
  return Math.min(6 * 3600_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Work through queued uploads; failures are recorded and retried later. Never reports success it did not verify. */
export async function processUploads(db: PrismaClient, label: { tenantId: string; scope: string }, now = new Date()) {
  const conn = await connection(db);
  const summary = { uploaded: 0, reused: 0, failed: 0, waiting: 0 };
  if (!conn || conn.status !== "CONNECTED") return summary;
  const due = await db.backupRun.findMany({
    where: { status: "VERIFIED", uploadStatus: { in: ["QUEUED", "FAILED", "UPLOADING"] }, OR: [{ uploadNextAt: null }, { uploadNextAt: { lte: now } }] },
    orderBy: { startedAt: "asc" },
  });
  for (const run of due) {
    if (!run.file || !fs.existsSync(run.file)) {
      await db.backupRun.update({ where: { id: run.id }, data: { uploadStatus: "FAILED", uploadError: "The local backup file is missing", uploadNextAt: null } });
      summary.failed++;
      continue;
    }
    await db.backupRun.update({ where: { id: run.id }, data: { uploadStatus: "UPLOADING" } });
    try {
      const r = await uploadBackup(db, { id: run.id, file: run.file, uploadSession: run.uploadSession }, label);
      await db.backupRun.update({ where: { id: run.id }, data: { uploadStatus: "UPLOADED", uploadRef: r.fileId, uploadedAt: new Date(), uploadError: null, uploadSession: null } });
      if (r.reused) summary.reused++;
      else summary.uploaded++;
    } catch (e) {
      const err = e instanceof DriveError ? e : new DriveError("SERVER", (e as Error).message);
      const attempts = run.uploadAttempts + 1;
      // Authorisation and permission problems wait for the owner instead of retrying in a loop
      const waitForOwner = ["AUTH_REVOKED", "PERMISSION", "NOT_CONNECTED", "NOT_CONFIGURED"].includes(err.kind);
      await db.backupRun.update({
        where: { id: run.id },
        data: { uploadStatus: "FAILED", uploadError: err.message, uploadAttempts: attempts, uploadNextAt: new Date(now.getTime() + (waitForOwner ? 6 * 3600_000 : retryDelay(attempts))) },
      });
      if (err.kind === "QUOTA" || err.kind === "NOT_FOUND") await db.driveConnection.update({ where: { id: "local" }, data: { lastError: err.message } });
      summary.failed++;
      if (err.kind === "NETWORK" || waitForOwner) {
        summary.waiting += due.length - (summary.uploaded + summary.reused + summary.failed);
        break; // no point trying the others now
      }
    }
  }
  return summary;
}
