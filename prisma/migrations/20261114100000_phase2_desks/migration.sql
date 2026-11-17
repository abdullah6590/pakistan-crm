-- Phase 2 of the old-program parity work (Report 33, owner approval 2026-11-14).
-- Additive only: new nullable columns; no existing row is changed.

-- The old invoice grid's per-line "Remarks"
ALTER TABLE "accounting_document_lines" ADD COLUMN "remarks" TEXT;

-- Cash sale: the walk-in customer's name and phone as typed (old Cash Sale "Name" and "Cell No")
ALTER TABLE "accounting_documents" ADD COLUMN "walkInName" TEXT;
ALTER TABLE "accounting_documents" ADD COLUMN "walkInPhone" TEXT;
