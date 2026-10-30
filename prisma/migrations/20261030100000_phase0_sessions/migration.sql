-- Phase 0: server-side session revocation metadata.
-- createdAt has no default: SQLite cannot add a column with a time-of-day default to a table that already has rows.
-- The app sets it on every new session; sessions made before this update keep it empty.
ALTER TABLE "sessions" ADD COLUMN "createdAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "revokeReason" TEXT;
ALTER TABLE "sessions" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "sessions" ADD COLUMN "ipHash" TEXT;

CREATE INDEX "sessions_userId_revokedAt_expires_idx"
ON "sessions"("userId", "revokedAt", "expires");

CREATE TABLE "rate_limit_buckets" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "windowStart" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "rate_limit_buckets_expiresAt_idx" ON "rate_limit_buckets"("expiresAt");
