-- Replicate document numbering counters so device previews never collide with official numbers
-- already in the replica (defect D-004, found by the Phase 3 sync tests).
CREATE TRIGGER "document_series_cl_ins" AFTER INSERT ON "document_series" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('document_series', NEW."series", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "document_series_cl_upd" AFTER UPDATE ON "document_series" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('document_series', NEW."series", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "document_series_cl_del" AFTER DELETE ON "document_series" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('document_series', OLD."series", 'D', CURRENT_TIMESTAMP); END;
