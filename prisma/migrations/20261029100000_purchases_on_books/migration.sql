-- Purchases on Books (Report 30): supplier details, bill due dates and supplier documents. Purely additive: new
-- nullable columns and one new table; no existing row or column is changed.

-- Supplier details: a contact person and the owner's own extra fields (JSON list of {label, value})
ALTER TABLE "suppliers" ADD COLUMN "contactPerson" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "customFields" TEXT;

-- Optional due date of a purchase bill (payment terms); null when none was given
ALTER TABLE "accounting_documents" ADD COLUMN "dueDate" DATETIME;

-- Supplier documents (scanned bill, delivery note) kept with a Books document. Stored in the business's own database,
-- so they are backed up with it and never visible to another business. Never deleted: removing one only marks it.
CREATE TABLE "document_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    "removedById" TEXT,
    "removeReason" TEXT,
    CONSTRAINT "document_attachments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accounting_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "document_attachments_documentId_idx" ON "document_attachments"("documentId");

CREATE TRIGGER "document_attachments_no_delete" BEFORE DELETE ON "document_attachments"
BEGIN SELECT RAISE(ABORT, 'document attachments are never deleted; mark them removed instead'); END;
CREATE TRIGGER "document_attachments_remove_only" BEFORE UPDATE ON "document_attachments"
WHEN NEW."documentId" IS NOT OLD."documentId" OR NEW."data" IS NOT OLD."data" OR NEW."sha256" IS NOT OLD."sha256" OR NEW."fileName" IS NOT OLD."fileName"
  OR (OLD."removedAt" IS NOT NULL AND NEW."removedAt" IS NOT OLD."removedAt")
BEGIN SELECT RAISE(ABORT, 'a document attachment can only be marked removed, once'); END;

-- Suppliers and customers are copied to desktops and office servers, so purchase bills, supplier payments, sales and
-- customer receipts can be entered there while offline (Report 30 §8; sync protocol 2)
CREATE TRIGGER "suppliers_cl_ins" AFTER INSERT ON "suppliers" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('suppliers', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "suppliers_cl_upd" AFTER UPDATE ON "suppliers" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('suppliers', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "suppliers_cl_del" AFTER DELETE ON "suppliers" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('suppliers', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "customers_cl_ins" AFTER INSERT ON "customers" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('customers', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "customers_cl_upd" AFTER UPDATE ON "customers" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('customers', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "customers_cl_del" AFTER DELETE ON "customers" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('customers', OLD."id", 'D', CURRENT_TIMESTAMP); END;
-- Computers that synchronised before this update receive the suppliers and customers that already exist
INSERT INTO "change_log" ("tbl", "rowId", "op", "at") SELECT 'suppliers', "id", 'I', CURRENT_TIMESTAMP FROM "suppliers";
INSERT INTO "change_log" ("tbl", "rowId", "op", "at") SELECT 'customers', "id", 'I', CURRENT_TIMESTAMP FROM "customers";
