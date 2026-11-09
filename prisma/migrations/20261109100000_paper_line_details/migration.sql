-- Paper details on bill lines (owner request 2026-11-09, as on the old Supplier Invoice screen): the size, GSM and
-- divisor the weight was worked out from, the weight of one unit of the line (e.g. kg per rim) and the rate per kg.
-- Additive only: existing lines keep these empty.
ALTER TABLE "accounting_document_lines" ADD COLUMN "paperX" TEXT;
ALTER TABLE "accounting_document_lines" ADD COLUMN "paperY" TEXT;
ALTER TABLE "accounting_document_lines" ADD COLUMN "paperGsm" TEXT;
ALTER TABLE "accounting_document_lines" ADD COLUMN "paperDivisor" TEXT;
ALTER TABLE "accounting_document_lines" ADD COLUMN "kgPerUnit" TEXT;
ALTER TABLE "accounting_document_lines" ADD COLUMN "ratePerKg" TEXT;
