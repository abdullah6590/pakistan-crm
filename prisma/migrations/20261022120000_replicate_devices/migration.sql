-- Replicate the device registry so an office hub can verify its office computers while the internet is down
-- (Phase 4). Only SHA-256 hashes of 256-bit random secrets are stored; they cannot be turned back into secrets.
CREATE TRIGGER "devices_cl_ins" AFTER INSERT ON "devices" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('devices', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "devices_cl_upd" AFTER UPDATE ON "devices" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('devices', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "devices_cl_del" AFTER DELETE ON "devices" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('devices', OLD."id", 'D', CURRENT_TIMESTAMP); END;
