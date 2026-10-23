-- AlterTable
ALTER TABLE "accounting_documents" ADD COLUMN "commandId" TEXT;
ALTER TABLE "accounting_documents" ADD COLUMN "originDeviceId" TEXT;

-- AlterTable
ALTER TABLE "charge_records" ADD COLUMN "commandId" TEXT;

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "hubId" TEXT,
    "registeredById" TEXT NOT NULL,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "lastSeenAt" DATETIME,
    "appVersion" TEXT
);

-- CreateTable
CREATE TABLE "sync_inbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "outbox_commands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "preview" TEXT,
    "provisionalRef" TEXT,
    "officialNumber" TEXT,
    "dependsOn" TEXT,
    "originDeviceId" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "result" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" DATETIME
);

-- CreateTable
CREATE TABLE "change_log" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tbl" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "at" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "upstreamId" TEXT NOT NULL PRIMARY KEY,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "number_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "series" TEXT NOT NULL,
    "fromNumber" INTEGER NOT NULL,
    "toNumber" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_code_key" ON "devices"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sync_inbox_deviceId_commandId_key" ON "sync_inbox"("deviceId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_commands_seq_key" ON "outbox_commands"("seq");

-- CreateIndex
CREATE INDEX "outbox_commands_status_seq_idx" ON "outbox_commands"("status", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "number_blocks_series_fromNumber_key" ON "number_blocks"("series", "fromNumber");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_documents_commandId_key" ON "accounting_documents"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "charge_records_commandId_key" ON "charge_records"("commandId");


-- Change feed (Report 21 §4): every insert, update and delete of a replicated table is logged in order
CREATE TRIGGER "users_cl_ins" AFTER INSERT ON "users" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('users', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "users_cl_upd" AFTER UPDATE ON "users" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('users', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "users_cl_del" AFTER DELETE ON "users" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('users', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "component_categories_cl_ins" AFTER INSERT ON "component_categories" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('component_categories', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "component_categories_cl_upd" AFTER UPDATE ON "component_categories" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('component_categories', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "component_categories_cl_del" AFTER DELETE ON "component_categories" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('component_categories', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "components_cl_ins" AFTER INSERT ON "components" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('components', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "components_cl_upd" AFTER UPDATE ON "components" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('components', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "components_cl_del" AFTER DELETE ON "components" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('components', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "ledger_accounts_cl_ins" AFTER INSERT ON "ledger_accounts" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('ledger_accounts', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "ledger_accounts_cl_upd" AFTER UPDATE ON "ledger_accounts" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('ledger_accounts', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "ledger_accounts_cl_del" AFTER DELETE ON "ledger_accounts" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('ledger_accounts', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_unit_profiles_cl_ins" AFTER INSERT ON "item_unit_profiles" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_unit_profiles', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_unit_profiles_cl_upd" AFTER UPDATE ON "item_unit_profiles" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_unit_profiles', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_unit_profiles_cl_del" AFTER DELETE ON "item_unit_profiles" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_unit_profiles', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_unit_conversions_cl_ins" AFTER INSERT ON "item_unit_conversions" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_unit_conversions', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_unit_conversions_cl_upd" AFTER UPDATE ON "item_unit_conversions" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_unit_conversions', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_unit_conversions_cl_del" AFTER DELETE ON "item_unit_conversions" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_unit_conversions', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "stock_locations_cl_ins" AFTER INSERT ON "stock_locations" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('stock_locations', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "stock_locations_cl_upd" AFTER UPDATE ON "stock_locations" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('stock_locations', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "stock_locations_cl_del" AFTER DELETE ON "stock_locations" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('stock_locations', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_documents_cl_ins" AFTER INSERT ON "accounting_documents" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_documents', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_documents_cl_upd" AFTER UPDATE ON "accounting_documents" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_documents', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_documents_cl_del" AFTER DELETE ON "accounting_documents" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_documents', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_document_lines_cl_ins" AFTER INSERT ON "accounting_document_lines" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_document_lines', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_document_lines_cl_upd" AFTER UPDATE ON "accounting_document_lines" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_document_lines', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_document_lines_cl_del" AFTER DELETE ON "accounting_document_lines" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_document_lines', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "journal_entries_cl_ins" AFTER INSERT ON "journal_entries" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('journal_entries', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "journal_entries_cl_upd" AFTER UPDATE ON "journal_entries" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('journal_entries', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "journal_entries_cl_del" AFTER DELETE ON "journal_entries" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('journal_entries', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "journal_lines_cl_ins" AFTER INSERT ON "journal_lines" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('journal_lines', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "journal_lines_cl_upd" AFTER UPDATE ON "journal_lines" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('journal_lines', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "journal_lines_cl_del" AFTER DELETE ON "journal_lines" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('journal_lines', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "stock_movements_cl_ins" AFTER INSERT ON "stock_movements" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('stock_movements', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "stock_movements_cl_upd" AFTER UPDATE ON "stock_movements" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('stock_movements', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "stock_movements_cl_del" AFTER DELETE ON "stock_movements" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('stock_movements', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_stock_balances_cl_ins" AFTER INSERT ON "item_stock_balances" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_stock_balances', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_stock_balances_cl_upd" AFTER UPDATE ON "item_stock_balances" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_stock_balances', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_stock_balances_cl_del" AFTER DELETE ON "item_stock_balances" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_stock_balances', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_cost_states_cl_ins" AFTER INSERT ON "item_cost_states" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_cost_states', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_cost_states_cl_upd" AFTER UPDATE ON "item_cost_states" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_cost_states', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "item_cost_states_cl_del" AFTER DELETE ON "item_cost_states" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('item_cost_states', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_settings_cl_ins" AFTER INSERT ON "accounting_settings" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_settings', NEW."key", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_settings_cl_upd" AFTER UPDATE ON "accounting_settings" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_settings', NEW."key", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "accounting_settings_cl_del" AFTER DELETE ON "accounting_settings" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('accounting_settings', OLD."key", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "charge_records_cl_ins" AFTER INSERT ON "charge_records" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('charge_records', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "charge_records_cl_upd" AFTER UPDATE ON "charge_records" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('charge_records', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "charge_records_cl_del" AFTER DELETE ON "charge_records" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('charge_records', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "audit_logs_cl_ins" AFTER INSERT ON "audit_logs" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('audit_logs', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "audit_logs_cl_upd" AFTER UPDATE ON "audit_logs" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('audit_logs', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "audit_logs_cl_del" AFTER DELETE ON "audit_logs" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('audit_logs', OLD."id", 'D', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "number_blocks_cl_ins" AFTER INSERT ON "number_blocks" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('number_blocks', NEW."id", 'I', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "number_blocks_cl_upd" AFTER UPDATE ON "number_blocks" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('number_blocks', NEW."id", 'U', CURRENT_TIMESTAMP); END;
CREATE TRIGGER "number_blocks_cl_del" AFTER DELETE ON "number_blocks" BEGIN INSERT INTO "change_log" ("tbl", "rowId", "op", "at") VALUES ('number_blocks', OLD."id", 'D', CURRENT_TIMESTAMP); END;
