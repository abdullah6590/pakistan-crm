-- Restore and disaster recovery (Phase 8, Report 23 §5). Purely additive.
-- node_state: values that belong to this computer only and are never replicated. SYNC_EPOCH changes whenever this
-- node's database is restored from a backup, so the computers that sync from it know to resend and resynchronise.
CREATE TABLE "node_state" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The upstream's epoch this computer last synchronised with
ALTER TABLE "sync_cursors" ADD COLUMN "epoch" TEXT;
