// src/lib/google-drive.ts — Client-side Google Drive Backup Integration
// Works entirely in the browser. No server-side credentials needed.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "CRM-Backups";

// ─── Types ───────────────────────────────────────────────────────────
export interface DriveFile {
  id: string;
  name: string;
  size: string;
  createdTime: string;
  modifiedTime: string;
  mimeType: string;
}

export interface GoogleDriveState {
  isConnected: boolean;
  accessToken: string | null;
  userEmail: string | null;
  userName: string | null;
  expiresAt: number | null;
}

// ─── Script Loader ───────────────────────────────────────────────────
let gisLoaded = false;

function loadGISScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gisLoaded && (window as any).google?.accounts) {
      resolve();
      return;
    }
    const existing = document.getElementById("google-gis-script");
    if (existing) {
      // Script tag exists, wait for it to load
      existing.addEventListener("load", () => { gisLoaded = true; resolve(); });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services")));
      if ((window as any).google?.accounts) { gisLoaded = true; resolve(); }
      return;
    }
    const script = document.createElement("script");
    script.id = "google-gis-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => { gisLoaded = true; resolve(); };
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

// ─── OAuth2 Token Flow ───────────────────────────────────────────────
export function requestAccessToken(clientId: string): Promise<{ accessToken: string; expiresIn: number }> {
  return new Promise(async (resolve, reject) => {
    try {
      await loadGISScript();
    } catch (e) {
      reject(e);
      return;
    }

    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      reject(new Error("Google Identity Services not available"));
      return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        resolve({
          accessToken: response.access_token,
          expiresIn: parseInt(response.expires_in, 10),
        });
      },
      error_callback: (error: any) => {
        reject(new Error(error.message || "OAuth2 error"));
      },
    });

    tokenClient.requestAccessToken();
  });
}

// ─── Get User Info ───────────────────────────────────────────────────
export async function getUserInfo(token: string): Promise<{ email: string; name: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to get user info");
  const data = await res.json();
  return { email: data.email, name: data.name || data.email };
}

// ─── Find or Create Backup Folder ────────────────────────────────────
async function getOrCreateFolder(token: string): Promise<string> {
  // Search for existing folder
  const query = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!searchRes.ok) throw new Error("Failed to search Google Drive");
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  if (!createRes.ok) throw new Error("Failed to create backup folder in Google Drive");
  const folder = await createRes.json();
  return folder.id;
}

// ─── Upload Backup to Google Drive ───────────────────────────────────
export async function uploadBackup(
  token: string,
  backupData: string,
  filename: string
): Promise<DriveFile> {
  const folderId = await getOrCreateFolder(token);

  // Use multipart upload for metadata + content
  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: "application/json",
    description: `CRM Backup - ${new Date().toLocaleString()}`,
  };

  const boundary = "crm_backup_boundary_" + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${backupData}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,mimeType`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || "Failed to upload backup to Google Drive");
  }

  return await res.json();
}

// ─── List Backups from Google Drive ──────────────────────────────────
export async function listBackups(token: string): Promise<DriveFile[]> {
  const folderId = await getOrCreateFolder(token);

  const query = `'${folderId}' in parents and trashed=false`;
  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,size,createdTime,modifiedTime,mimeType)&orderBy=createdTime desc&pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) throw new Error("Failed to list backups from Google Drive");
  const data = await res.json();
  return data.files || [];
}

// ─── Download Backup from Google Drive ───────────────────────────────
export async function downloadBackup(token: string, fileId: string): Promise<any> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error("Failed to download backup from Google Drive");
  return await res.json();
}

// ─── Delete Backup from Google Drive ─────────────────────────────────
export async function deleteBackup(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error("Failed to delete backup from Google Drive");
}

// ─── Revoke Access ───────────────────────────────────────────────────
export async function revokeAccess(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

// ─── Local State Persistence ─────────────────────────────────────────
const STORAGE_KEY = "crm_gdrive_state";
const HISTORY_KEY = "crm_backup_history";

export function saveGDriveState(state: GoogleDriveState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function loadGDriveState(): GoogleDriveState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const state = JSON.parse(stored) as GoogleDriveState;
      // Check if token is expired
      if (state.expiresAt && Date.now() > state.expiresAt) {
        return { isConnected: false, accessToken: null, userEmail: null, userName: null, expiresAt: null };
      }
      return state;
    }
  } catch {}
  return { isConnected: false, accessToken: null, userEmail: null, userName: null, expiresAt: null };
}

export function clearGDriveState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// ─── Backup History (Local Tracking) ─────────────────────────────────
export interface BackupHistoryEntry {
  id: string;
  type: "local" | "google-drive";
  filename: string;
  timestamp: string;
  sizeBytes: number;
  driveFileId?: string;
  status: "success" | "failed";
}

export function getBackupHistory(): BackupHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

export function addBackupHistory(entry: BackupHistoryEntry): void {
  try {
    const history = getBackupHistory();
    history.unshift(entry); // newest first
    // Keep only last 100 entries
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  } catch {}
}

// ─── Format Helpers ──────────────────────────────────────────────────
export function formatFileSize(bytes: number | string): string {
  const b = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(b) || b === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
