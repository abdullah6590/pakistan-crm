-- Payment allocations (Report 28): which receipt paid which invoice or refund. Purely additive.
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creditDocId" TEXT NOT NULL,
    "debitDocId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "movedFromId" TEXT,
    "requestId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "releasedById" TEXT,
    "releaseReason" TEXT,
    CONSTRAINT "payment_allocations_creditDocId_fkey" FOREIGN KEY ("creditDocId") REFERENCES "accounting_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_allocations_debitDocId_fkey" FOREIGN KEY ("debitDocId") REFERENCES "accounting_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_allocations_requestId_key" ON "payment_allocations"("requestId");
CREATE INDEX "payment_allocations_creditDocId_idx" ON "payment_allocations"("creditDocId");
CREATE INDEX "payment_allocations_debitDocId_idx" ON "payment_allocations"("debitDocId");

-- An allocation is a record: never deleted; only its release fields may be set, once (rewriting the same values,
-- as a desktop does when a row is delivered again, is allowed)
CREATE TRIGGER "payment_allocations_no_delete" BEFORE DELETE ON "payment_allocations"
BEGIN SELECT RAISE(ABORT, 'payment allocations are never deleted; release them instead'); END;
CREATE TRIGGER "payment_allocations_release_only" BEFORE UPDATE ON "payment_allocations"
WHEN NEW."creditDocId" IS NOT OLD."creditDocId" OR NEW."debitDocId" IS NOT OLD."debitDocId" OR NEW."amount" IS NOT OLD."amount"
  OR (OLD."releasedAt" IS NOT NULL AND (NEW."releasedAt" IS NOT OLD."releasedAt" OR NEW."releasedById" IS NOT OLD."releasedById" OR NEW."releaseReason" IS NOT OLD."releaseReason"))
BEGIN SELECT RAISE(ABORT, 'a payment allocation can only be released, once'); END;

-- Replicated to desktops and office servers (Report 21 §4)
CREATE TRIGGER "payment_allocations_cl_ins" AFTER INSERT ON "payment_allocations" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('payment_allocations', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "payment_allocations_cl_upd" AFTER UPDATE ON "payment_allocations" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('payment_allocations', NEW."id", 'U', CURRENT_TIMESTAMP); END;
