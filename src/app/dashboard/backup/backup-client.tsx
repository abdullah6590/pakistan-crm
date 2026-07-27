"use client";

import { useState, useEffect, useRef } from "react";
import {
  HardDrive, Download, Upload, AlertTriangle, CheckCircle2, Loader2,
  Users, ShoppingCart, Truck, Package, Cloud, CloudOff, RefreshCw,
  Trash2, Clock, Shield, ExternalLink, LogOut, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import {
  requestAccessToken, getUserInfo, uploadBackup, listBackups,
  downloadBackup, deleteBackup, revokeAccess,
  saveGDriveState, loadGDriveState, clearGDriveState,
  addBackupHistory, getBackupHistory, formatFileSize,
  type GoogleDriveState, type DriveFile, type BackupHistoryEntry,
} from "@/lib/google-drive";

interface Props {
  stats: { users: number; customers: number; suppliers: number; components: number; sales: number; purchases: number };
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export default function BackupClient({ stats }: Props) {
  // Local backup state
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Google Drive state
  const [gdrive, setGDrive] = useState<GoogleDriveState>({
    isConnected: false, accessToken: null, userEmail: null, userName: null, expiresAt: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [restoringFromDrive, setRestoringFromDrive] = useState<string | null>(null);
  const [deletingFromDrive, setDeletingFromDrive] = useState<string | null>(null);

  // Backup history
  const [history, setHistory] = useState<BackupHistoryEntry[]>([]);

  // Load saved state on mount
  useEffect(() => {
    const saved = loadGDriveState();
    if (saved.isConnected && saved.accessToken) {
      setGDrive(saved);
    }
    setHistory(getBackupHistory());
  }, []);

  // Load Drive files when connected
  useEffect(() => {
    if (gdrive.isConnected && gdrive.accessToken) {
      refreshDriveFiles();
    }
  }, [gdrive.isConnected]);

  // ─── Local Backup ──────────────────────────────────────────────────
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("Failed to generate backup");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const filename = `crm-backup-${new Date().toISOString().split("T")[0]}.json`;
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      window.URL.revokeObjectURL(url); document.body.removeChild(a);

      addBackupHistory({
        id: crypto.randomUUID(),
        type: "local",
        filename,
        timestamp: new Date().toISOString(),
        sizeBytes: blob.size,
        status: "success",
      });
      setHistory(getBackupHistory());
      toast.success("Backup downloaded successfully");
    } catch {
      toast.error("Failed to download backup");
    }
    setDownloading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.type !== "application/json" && !selected.name.endsWith(".json")) {
        toast.error("Please select a valid JSON backup file");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setFile(selected);
    }
  };

  const handleRestore = async () => {
    if (!file) return;
    setRestoring(true);
    try {
      const text = await file.text();
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error("Invalid JSON file"); }

      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Database restored successfully!");
        setTimeout(() => window.location.href = "/dashboard", 2000);
      } else {
        throw new Error(data.error || "Restore failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to restore database");
    }
    setRestoring(false);
    setShowConfirm(false);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Google Drive ──────────────────────────────────────────────────
  const handleConnectDrive = async () => {
    if (!GOOGLE_CLIENT_ID) {
      toast.error("Google Client ID not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to your .env.local file.");
      return;
    }
    setConnecting(true);
    try {
      const { accessToken, expiresIn } = await requestAccessToken(GOOGLE_CLIENT_ID);
      const userInfo = await getUserInfo(accessToken);
      const state: GoogleDriveState = {
        isConnected: true,
        accessToken,
        userEmail: userInfo.email,
        userName: userInfo.name,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      setGDrive(state);
      saveGDriveState(state);
      toast.success(`Connected as ${userInfo.email}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to connect to Google Drive");
    }
    setConnecting(false);
  };

  const handleDisconnectDrive = async () => {
    if (gdrive.accessToken) {
      try { await revokeAccess(gdrive.accessToken); } catch {}
    }
    clearGDriveState();
    setGDrive({ isConnected: false, accessToken: null, userEmail: null, userName: null, expiresAt: null });
    setDriveFiles([]);
    toast.success("Disconnected from Google Drive");
  };

  const refreshDriveFiles = async () => {
    if (!gdrive.accessToken) return;
    setLoadingFiles(true);
    try {
      const files = await listBackups(gdrive.accessToken);
      setDriveFiles(files);
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("invalid")) {
        // Token expired, disconnect
        clearGDriveState();
        setGDrive({ isConnected: false, accessToken: null, userEmail: null, userName: null, expiresAt: null });
        toast.error("Google session expired. Please reconnect.");
      } else {
        toast.error("Failed to load Drive backups");
      }
    }
    setLoadingFiles(false);
  };

  const handleUploadToDrive = async () => {
    if (!gdrive.accessToken) return;
    setUploading(true);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("Failed to generate backup");
      const backupText = await res.text();
      const filename = `crm-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const driveFile = await uploadBackup(gdrive.accessToken, backupText, filename);

      addBackupHistory({
        id: crypto.randomUUID(),
        type: "google-drive",
        filename,
        timestamp: new Date().toISOString(),
        sizeBytes: parseInt(driveFile.size || "0", 10),
        driveFileId: driveFile.id,
        status: "success",
      });
      setHistory(getBackupHistory());
      await refreshDriveFiles();
      toast.success("Backup uploaded to Google Drive!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload to Google Drive");
    }
    setUploading(false);
  };

  const handleRestoreFromDrive = async (fileId: string, fileName: string) => {
    if (!gdrive.accessToken) return;
    setRestoringFromDrive(fileId);
    try {
      const payload = await downloadBackup(gdrive.accessToken, fileId);
      if (!payload.version || !payload.data) throw new Error("Invalid backup file format");
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Restored from ${fileName}`);
        setTimeout(() => window.location.href = "/dashboard", 2000);
      } else {
        throw new Error(data.error || "Restore failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to restore from Drive");
    }
    setRestoringFromDrive(null);
  };

  const handleDeleteFromDrive = async (fileId: string) => {
    if (!gdrive.accessToken) return;
    setDeletingFromDrive(fileId);
    try {
      await deleteBackup(gdrive.accessToken, fileId);
      await refreshDriveFiles();
      toast.success("Backup deleted from Drive");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete from Drive");
    }
    setDeletingFromDrive(null);
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <PageHeader
        title="System Backup & Restore"
        description="Safeguard your data locally or sync to Google Drive for cloud protection."
        icon={HardDrive}
      />

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard title="Users" val={stats.users} icon={Users} />
        <StatCard title="Customers" val={stats.customers} icon={Users} />
        <StatCard title="Suppliers" val={stats.suppliers} icon={Truck} />
        <StatCard title="Inventory" val={stats.components} icon={Package} />
        <StatCard title="Sales" val={stats.sales} icon={ShoppingCart} />
        <StatCard title="Purchases" val={stats.purchases} icon={Truck} />
      </div>

      {/* Main Grid: Local + Cloud */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* ─── LOCAL BACKUP ─────────────────────────────────────── */}
        <Card className="border-blue-500/20 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Download className="h-5 w-5" /> Local Backup
            </CardTitle>
            <CardDescription>
              Download a complete JSON snapshot to your computer or USB drive.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertTitle className="text-blue-800 dark:text-blue-300">Recommended</AlertTitle>
              <AlertDescription className="text-blue-700/80 dark:text-blue-300/80 text-xs mt-1">
                Take a backup before performing any major system updates or at the end of each business week.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button onClick={handleDownload} disabled={downloading} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              {downloading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Backup...</> : <><Download className="mr-2 h-4 w-4" /> Download JSON Backup</>}
            </Button>
          </CardFooter>
        </Card>

        {/* ─── GOOGLE DRIVE BACKUP ──────────────────────────────── */}
        <Card className="border-emerald-500/20 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Cloud className="h-5 w-5" /> Google Drive Backup
            </CardTitle>
            <CardDescription>
              Automatically sync your backups to Google Drive for cloud protection.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!GOOGLE_CLIENT_ID ? (
              <Alert className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertTitle className="text-amber-800 dark:text-amber-300">Setup Required</AlertTitle>
                <AlertDescription className="text-amber-700/80 dark:text-amber-300/80 text-xs mt-1">
                  To enable Google Drive backup, add <code className="bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded text-[10px]">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> to your <code className="bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded text-[10px]">.env.local</code> file.
                </AlertDescription>
              </Alert>
            ) : gdrive.isConnected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-sm font-bold">
                      {(gdrive.userName || "U")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{gdrive.userName}</p>
                      <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">{gdrive.userEmail}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleDisconnectDrive} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Alert className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
                <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <AlertTitle className="text-emerald-800 dark:text-emerald-300">Cloud Protection</AlertTitle>
                <AlertDescription className="text-emerald-700/80 dark:text-emerald-300/80 text-xs mt-1">
                  Connect your Google account to automatically backup your data to Google Drive. Your backups are stored in a private &quot;CRM-Backups&quot; folder.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            {gdrive.isConnected ? (
              <Button onClick={handleUploadToDrive} disabled={uploading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading to Drive...</> : <><Cloud className="mr-2 h-4 w-4" /> Backup to Google Drive Now</>}
              </Button>
            ) : (
              <Button onClick={handleConnectDrive} disabled={connecting || !GOOGLE_CLIENT_ID} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                {connecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...</> : <><Cloud className="mr-2 h-4 w-4" /> Connect Google Drive</>}
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* ─── LOCAL RESTORE ────────────────────────────────────── */}
        <Card className="border-red-500/20 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Upload className="h-5 w-5" /> Restore from File
            </CardTitle>
            <CardDescription>
              Upload a previously exported JSON backup file to overwrite the current database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning: Destructive Action</AlertTitle>
              <AlertDescription className="text-xs mt-1">
                Restoring a backup will <strong>permanently erase</strong> all current data and replace it with the backup data. This cannot be undone.
              </AlertDescription>
            </Alert>
            <div className="pt-2">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                disabled={restoring}
                className="cursor-pointer file:cursor-pointer file:bg-muted file:border-0 file:rounded-md file:px-3 file:py-1 file:mr-4 file:text-sm file:font-medium"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="destructive"
              onClick={() => setShowConfirm(true)}
              disabled={!file || restoring}
              className="w-full"
            >
              {restoring ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring Database...</> : <><Upload className="mr-2 h-4 w-4" /> Restore from JSON</>}
            </Button>
          </CardFooter>
        </Card>

        {/* ─── DRIVE BACKUPS LIST ───────────────────────────────── */}
        <Card className="border-purple-500/20 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                  <Cloud className="h-5 w-5" /> Cloud Backups
                </CardTitle>
                <CardDescription>
                  {gdrive.isConnected
                    ? `${driveFiles.length} backup(s) stored in Google Drive`
                    : "Connect Google Drive to view cloud backups"}
                </CardDescription>
              </div>
              {gdrive.isConnected && (
                <Button variant="ghost" size="icon" onClick={refreshDriveFiles} disabled={loadingFiles}>
                  <RefreshCw className={`h-4 w-4 ${loadingFiles ? "animate-spin" : ""}`} />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!gdrive.isConnected ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                <CloudOff className="h-5 w-5 mr-2 opacity-50" /> Not connected to Google Drive
              </div>
            ) : loadingFiles ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading backups...
              </div>
            ) : driveFiles.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                No cloud backups yet. Click &quot;Backup to Google Drive&quot; to create one.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-2">
                {driveFiles.map((f) => (
                  <div key={f.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(f.createdTime).toLocaleString()} · {formatFileSize(f.size)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleRestoreFromDrive(f.id, f.name)}
                        disabled={restoringFromDrive === f.id}
                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-8 px-2"
                      >
                        {restoringFromDrive === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleDeleteFromDrive(f.id)}
                        disabled={deletingFromDrive === f.id}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 px-2"
                      >
                        {deletingFromDrive === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── BACKUP HISTORY ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Backup History
          </CardTitle>
          <CardDescription>A log of all backup and restore operations performed on this device.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No backup history yet. Take your first backup above!
                  </TableCell>
                </TableRow>
              ) : (
                history.slice(0, 20).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(h.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={h.type === "google-drive" ? "default" : "secondary"} className="text-xs">
                        {h.type === "google-drive" ? (
                          <><Cloud className="h-3 w-3 mr-1" /> Drive</>
                        ) : (
                          <><HardDrive className="h-3 w-3 mr-1" /> Local</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono truncate max-w-xs">{h.filename}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatFileSize(h.sizeBytes)}</TableCell>
                    <TableCell>
                      <Badge variant={h.status === "success" ? "default" : "destructive"} className="text-xs">
                        {h.status === "success" ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                        {h.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleRestore}
        title="DANGER: Confirm Database Overwrite"
        description="Are you absolutely sure you want to restore from this backup? ALL current data will be deleted and replaced. You will be logged out if your session does not exist in the backup."
        confirmLabel="Yes, Overwrite Everything"
      />
    </div>
  );
}

function StatCard({ title, val, icon: Icon }: { title: string; val: number; icon: any }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-xl font-bold">{val.toLocaleString()}</p>
        </div>
        <div className="p-2 bg-muted rounded-full">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
