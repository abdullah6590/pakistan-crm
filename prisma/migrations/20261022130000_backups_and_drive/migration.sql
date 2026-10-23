-- CreateTable
CREATE TABLE "backup_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "directory" TEXT,
    "dailyTime" TEXT NOT NULL DEFAULT '02:00',
    "frequentMinutes" INTEGER NOT NULL DEFAULT 60,
    "keepDaily" INTEGER NOT NULL DEFAULT 14,
    "keepFrequent" INTEGER NOT NULL DEFAULT 24,
    "protectedPassphrase" TEXT,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "file" TEXT,
    "sizeBytes" INTEGER,
    "changeSeq" INTEGER,
    "manifest" TEXT,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "uploadStatus" TEXT,
    "uploadRef" TEXT,
    "uploadError" TEXT,
    "uploadedAt" DATETIME,
    "uploadSession" TEXT,
    "uploadAttempts" INTEGER NOT NULL DEFAULT 0,
    "uploadNextAt" DATETIME
);

-- CreateTable
CREATE TABLE "drive_connections" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local',
    "status" TEXT NOT NULL,
    "accountEmail" TEXT,
    "folderId" TEXT,
    "folderName" TEXT,
    "protectedRefreshToken" TEXT,
    "pkceVerifier" TEXT,
    "oauthState" TEXT,
    "redirectUri" TEXT,
    "uploadFrequent" BOOLEAN NOT NULL DEFAULT false,
    "keepRemote" INTEGER NOT NULL DEFAULT 30,
    "lastError" TEXT,
    "quotaBytes" TEXT,
    "usedBytes" TEXT,
    "connectedById" TEXT,
    "connectedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "backup_runs_status_startedAt_idx" ON "backup_runs"("status", "startedAt");

