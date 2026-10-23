// Phase 7: Google Drive backups against a local imitation of Google's OAuth and Drive endpoints.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb } from "@/lib/accounting/test-db";
import { createBackup } from "./service";
import { startFakeGoogle } from "./fake-google";
import { readManifest } from "./format";
import { startAuthorization, completeAuthorization, ensureFolder, queueUpload, processUploads, disconnectDrive, pruneRemote, clearAccessCache, DRIVE_SCOPE, listRemoteBackups, downloadRemote } from "./drive";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let db: PrismaClient;
let file: string;
let dir: string;
let cleanup: () => Promise<void>;
let google: Awaited<ReturnType<typeof startFakeGoogle>>;
const PASS = "drive backup passphrase 2026";
const label = { tenantId: "t_shop", scope: "server" };
const saved = { ...process.env };

async function backup(type: "DAILY" | "MANUAL" | "FREQUENT" = "DAILY") {
  const r = await createBackup({ db, dbFile: file, tenant: { id: label.tenantId, name: "Shop" }, scope: label.scope, appVersion: "0.1.0" }, { directory: path.join(dir, "Backups"), passphrase: PASS, type, trigger: "SCHEDULE" });
  await queueUpload(db, r.backupId, type);
  return r;
}
const run = (id: string) => db.backupRun.findUniqueOrThrow({ where: { id } });
const remoteFiles = () => [...google.state.files.values()].filter((f) => !f.mimeType);

beforeAll(async () => {
  ({ db, file, dir, cleanup } = await createTestDb());
  fs.mkdirSync(path.join(dir, "Backups"));
  google = await startFakeGoogle();
  Object.assign(process.env, {
    GOOGLE_OAUTH_CLIENT_ID: "test-client.apps.googleusercontent.com", GOOGLE_AUTH_URL: `${google.base}/auth`, GOOGLE_TOKEN_URL: `${google.base}/token`,
    DRIVE_API_BASE: `${google.base}/drive/v3`, DRIVE_UPLOAD_BASE: `${google.base}/upload/drive/v3`, GOOGLE_REVOKE_URL: `${google.base}/revoke`,
    DRIVE_CHUNK_BYTES: String(256 * 1024), CRM_TOKEN_KEY: "ab".repeat(32), CRM_NODE_ROLE: "cloud",
  });
});

afterAll(async () => {
  process.env = saved;
  await google?.close();
  await cleanup?.();
});

describe("connecting a Google account", () => {
  it("uses Google's consent page with PKCE and the narrowest scope; stores only a protected refresh token", async () => {
    const authUrl = await startAuthorization(db, { redirectUri: "http://127.0.0.1:3920/api/drive/callback", userId: "u1" });
    const u = new URL(authUrl);
    expect([u.searchParams.get("scope"), u.searchParams.get("code_challenge_method"), u.searchParams.get("access_type")]).toEqual([DRIVE_SCOPE, "S256", "offline"]);
    // A callback with a forged state is refused
    await expect(completeAuthorization(db, { code: "x", state: "forged" })).rejects.toThrow(/state mismatch/);
    const consent = google.consent(authUrl);
    await completeAuthorization(db, consent);
    const conn = await db.driveConnection.findUniqueOrThrow({ where: { id: "local" } });
    expect([conn.status, conn.accountEmail, conn.pkceVerifier, conn.oauthState]).toEqual(["CONNECTED", "owner@business.example", null, null]);
    const issued = [...google.state.refresh][0];
    expect(conn.protectedRefreshToken!.startsWith("aes:")).toBe(true);
    expect(conn.protectedRefreshToken).not.toContain(issued);
    expect(fs.readFileSync(file).includes(Buffer.from(issued))).toBe(false);
  });

  it("creates the business's backup folder once and reuses it", async () => {
    const a = await ensureFolder(db, "Pakistan CRM Backups - Shop", label.tenantId);
    const b = await ensureFolder(db, "Pakistan CRM Backups - Shop", label.tenantId);
    expect(a).toBe(b);
    expect([...google.state.files.values()].filter((f) => f.mimeType === "application/vnd.google-apps.folder").length).toBe(1);
  });
});

describe("uploading", () => {
  it("uploads a verified backup and records Google's file id only after the checksum matches", async () => {
    const b = await backup();
    const s = await processUploads(db, label);
    expect(s.uploaded).toBe(1);
    const r = await run(b.backupId);
    expect([r.uploadStatus, r.uploadRef?.startsWith("file-")]).toEqual(["UPLOADED", true]);
    const remote = google.state.files.get(r.uploadRef!)!;
    expect(remote.data.equals(fs.readFileSync(b.file))).toBe(true);
    expect(remote.appProperties).toMatchObject({ crmBackupId: b.backupId, crmTenant: "t_shop", crmScope: "server" });
  });

  it("an interrupted upload resumes from the last confirmed byte and ends as one file", async () => {
    const b = await backup("MANUAL");
    google.state.dropAfterOneChunk = true;
    const first = await processUploads(db, label);
    expect(first.failed).toBe(1);
    const failed = await run(b.backupId);
    expect([failed.uploadStatus, !!failed.uploadSession, failed.uploadError]).toEqual(["FAILED", true, expect.stringMatching(/interrupted/)]);
    const later = await processUploads(db, label, new Date(Date.now() + 3600_000));
    expect(later.uploaded).toBe(1);
    expect(google.state.resumeQueries).toBeGreaterThan(0);
    const files = remoteFiles().filter((f) => f.appProperties.crmBackupId === b.backupId);
    expect(files.length).toBe(1);
    expect(files[0].data.equals(fs.readFileSync(b.file))).toBe(true);
  });

  it("a retry after the upload already finished does not create a duplicate", async () => {
    const before = remoteFiles().length;
    const last = await db.backupRun.findFirstOrThrow({ where: { uploadStatus: "UPLOADED" }, orderBy: { startedAt: "desc" } });
    // The computer stopped right after Google stored the file, before recording it
    await db.backupRun.update({ where: { id: last.id }, data: { uploadStatus: "QUEUED", uploadRef: null, uploadNextAt: null } });
    const s = await processUploads(db, label);
    expect(s.reused).toBe(1);
    expect(remoteFiles().length).toBe(before);
    expect((await run(last.id)).uploadRef).toBe(last.uploadRef);
  });

  it("offline: the upload waits; the local backup is unaffected; it goes through when Google is reachable", async () => {
    google.state.down = true;
    const b = await backup();
    expect((await run(b.backupId)).status).toBe("VERIFIED");
    const s = await processUploads(db, label);
    expect(s.failed).toBe(1);
    const r = await run(b.backupId);
    expect([r.uploadStatus, r.uploadNextAt!.getTime() > Date.now()]).toEqual(["FAILED", true]);
    google.state.down = false;
    expect((await processUploads(db, label, new Date(Date.now() + 6 * 3600_000))).uploaded).toBe(1);
    expect((await run(b.backupId)).uploadStatus).toBe("UPLOADED");
  });

  it("a full Drive and a corrupted remote copy are reported, never shown as uploaded", async () => {
    google.state.quotaFull = true;
    const full = await backup();
    await processUploads(db, label);
    expect(await run(full.backupId)).toMatchObject({ uploadStatus: "FAILED", uploadError: expect.stringMatching(/Google Drive is full/) });
    google.state.quotaFull = false;
    google.state.corrupt = true;
    await processUploads(db, label, new Date(Date.now() + 7 * 3600_000));
    expect(await run(full.backupId)).toMatchObject({ uploadStatus: "FAILED", uploadError: expect.stringMatching(/did not match/) });
    expect(remoteFiles().filter((f) => f.appProperties.crmBackupId === full.backupId).length).toBe(0); // bad copy removed
    google.state.corrupt = false;
    await processUploads(db, label, new Date(Date.now() + 8 * 3600_000));
    expect((await run(full.backupId)).uploadStatus).toBe("UPLOADED");
  });

  it("keeps the newest copies on Drive for this business only", async () => {
    google.state.files.set("other-tenant", { id: "other-tenant", name: "x.pkbk", parents: [], appProperties: { crmTenant: "t_other", crmScope: "server", crmBackupId: "z" }, data: Buffer.from("x"), createdTime: new Date(0).toISOString(), trashed: false });
    const removed = await pruneRemote(db, label, 2);
    expect(removed.length).toBeGreaterThan(0);
    expect(remoteFiles().filter((f) => f.appProperties.crmTenant === "t_shop").length).toBe(2);
    expect(google.state.files.has("other-tenant")).toBe(true);
  });
});

describe("restoring from Drive (Report 23)", () => {
  it("lists this business's backups from every computer, downloads one with its checksum checked, and refuses other businesses' files", async () => {
    const own = await backup("MANUAL");
    await processUploads(db, label);
    const pkg = fs.readFileSync(own.file);
    google.state.files.set("failed-pc", { id: "failed-pc", name: "d07.pkbk", parents: [], appProperties: { crmTenant: "t_shop", crmScope: "device-D07", crmBackupId: "b-d07" }, data: pkg, createdTime: new Date().toISOString(), trashed: false });
    const list = await listRemoteBackups(db, label.tenantId);
    expect(list.some((f) => f.scope === "device-D07")).toBe(true); // a replacement computer finds the failed one's backups
    expect(list.every((f) => f.backupId && f.fileId !== "other-tenant")).toBe(true);

    const mine = list.find((f) => f.backupId === own.backupId)!;
    const dst = path.join(dir, "downloads", "restore.pkbk");
    const got = await downloadRemote(db, label.tenantId, mine.fileId, dst);
    expect([got.backupId, fs.readFileSync(dst).equals(pkg), readManifest(dst).tenantId]).toEqual([own.backupId, true, "t_shop"]);
    await expect(downloadRemote(db, label.tenantId, "other-tenant", path.join(dir, "downloads", "x.pkbk"))).rejects.toThrow(/not a backup of this business/);
    expect(fs.existsSync(path.join(dir, "downloads", "x.pkbk"))).toBe(false);
  });
});

describe("losing and removing access", () => {
  it("revoked access marks the connection for reconnecting and stops retries", async () => {
    google.state.refresh.clear(); // the owner removed the app in their Google Account
    clearAccessCache(); // force the next call to use the (now revoked) refresh token
    const b = await backup();
    await processUploads(db, label);
    expect((await db.driveConnection.findUniqueOrThrow({ where: { id: "local" } })).status).toBe("REVOKED");
    expect((await run(b.backupId)).uploadStatus).not.toBe("UPLOADED");
  });

  it("disconnecting revokes the grant at Google and deletes the stored token", async () => {
    const authUrl = await startAuthorization(db, { redirectUri: "http://127.0.0.1:3920/api/drive/callback", userId: "u1" });
    await completeAuthorization(db, google.consent(authUrl));
    const token = [...google.state.refresh].pop()!;
    const r = await disconnectDrive(db);
    expect(r.revokedAtGoogle).toBe(true);
    expect(google.state.revoked).toContain(token);
    const conn = await db.driveConnection.findUniqueOrThrow({ where: { id: "local" } });
    expect([conn.status, conn.protectedRefreshToken]).toEqual(["REVOKED", null]);
  });
});
