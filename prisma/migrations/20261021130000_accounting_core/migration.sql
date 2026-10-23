-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subType" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "financialAccountId" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "item_unit_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "componentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PIECE',
    "baseUnit" TEXT NOT NULL DEFAULT 'piece',
    "baseDecimals" INTEGER NOT NULL DEFAULT 0,
    "purchaseUnit" TEXT,
    "saleUnit" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "referencePurchasePrice" TEXT,
    "referenceExpenses" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "item_unit_profiles_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "components" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "item_unit_conversions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "item_unit_conversions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "item_unit_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "partyAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_locations_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "ledger_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "accounting_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "docNo" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "partyAccountId" TEXT,
    "cashAccountId" TEXT,
    "counterAccountId" TEXT,
    "locationId" TEXT,
    "toLocationId" TEXT,
    "reason" TEXT,
    "remarks" TEXT,
    "vendorBillNo" TEXT,
    "vendorBillDate" DATETIME,
    "biltyNo" TEXT,
    "biltyDate" DATETIME,
    "roundingMode" TEXT,
    "exactTotal" TEXT NOT NULL DEFAULT '0',
    "total" TEXT NOT NULL DEFAULT '0',
    "roundingAdjustment" TEXT NOT NULL DEFAULT '0',
    "amountReceived" TEXT,
    "extraCharge" TEXT,
    "previousBalance" TEXT,
    "newBalance" TEXT,
    "hasCostEstimate" BOOLEAN NOT NULL DEFAULT false,
    "hasNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "submittedAt" DATETIME,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "rejectedById" TEXT,
    "rejectedAt" DATETIME,
    "rejectionReason" TEXT,
    "postedAt" DATETIME,
    "cancelledById" TEXT,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "supersedesId" TEXT,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" DATETIME,
    "chargeId" TEXT,
    "returnOfId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "legacyRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "accounting_documents_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "ledger_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "accounting_documents_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "ledger_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "accounting_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "accounting_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "accounting_documents_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "accounting_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "accounting_documents_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charge_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "accounting_document_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "componentId" TEXT,
    "description" TEXT,
    "quantity" TEXT NOT NULL DEFAULT '0',
    "unit" TEXT,
    "loose" TEXT NOT NULL DEFAULT '0',
    "baseQuantity" TEXT NOT NULL DEFAULT '0',
    "unitPrice" TEXT NOT NULL DEFAULT '0',
    "loosePrice" TEXT NOT NULL DEFAULT '0',
    "amount" TEXT NOT NULL DEFAULT '0',
    "costAmount" TEXT,
    "costStatus" TEXT,
    "costNote" TEXT,
    "stockWarning" TEXT,
    "consumedComponentId" TEXT,
    "consumedQuantity" TEXT,
    "returnOfLineNo" INTEGER,
    "bookQuantity" TEXT,
    CONSTRAINT "accounting_document_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accounting_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "accounting_document_lines_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "components" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'POSTING',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entries_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accounting_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitPaisa" BIGINT NOT NULL DEFAULT 0,
    "creditPaisa" BIGINT NOT NULL DEFAULT 0,
    "memo" TEXT,
    CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "lineNo" INTEGER,
    "componentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "balanceAfter" TEXT NOT NULL,
    "costAmount" TEXT,
    "costStatus" TEXT,
    "warning" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accounting_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "components" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "item_stock_balances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "componentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" TEXT NOT NULL DEFAULT '0',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "item_stock_balances_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "components" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "item_cost_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "componentId" TEXT NOT NULL,
    "onHand" TEXT NOT NULL DEFAULT '0',
    "averageCost" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "item_cost_states_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "components" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_series" (
    "series" TEXT NOT NULL PRIMARY KEY,
    "nextNumber" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "accounting_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "charge_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "chargeNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partyAccountId" TEXT,
    "documentId" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "postedDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledById" TEXT,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "charge_records_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accounting_documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_customerId_key" ON "ledger_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_supplierId_key" ON "ledger_accounts"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_financialAccountId_key" ON "ledger_accounts"("financialAccountId");

-- CreateIndex
CREATE INDEX "ledger_accounts_kind_idx" ON "ledger_accounts"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "item_unit_profiles_componentId_key" ON "item_unit_profiles"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "item_unit_conversions_profileId_code_key" ON "item_unit_conversions"("profileId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_code_key" ON "stock_locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_documents_supersedesId_key" ON "accounting_documents"("supersedesId");

-- CreateIndex
CREATE INDEX "accounting_documents_chargeId_idx" ON "accounting_documents"("chargeId");

-- CreateIndex
CREATE INDEX "accounting_documents_returnOfId_idx" ON "accounting_documents"("returnOfId");

-- CreateIndex
CREATE INDEX "accounting_documents_type_date_idx" ON "accounting_documents"("type", "date");

-- CreateIndex
CREATE INDEX "accounting_documents_partyAccountId_date_idx" ON "accounting_documents"("partyAccountId", "date");

-- CreateIndex
CREATE INDEX "accounting_documents_status_idx" ON "accounting_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_documents_series_number_revision_key" ON "accounting_documents"("series", "number", "revision");

-- CreateIndex
CREATE INDEX "accounting_document_lines_componentId_idx" ON "accounting_document_lines"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_document_lines_documentId_lineNo_key" ON "accounting_document_lines"("documentId", "lineNo");

-- CreateIndex
CREATE INDEX "journal_entries_documentId_idx" ON "journal_entries"("documentId");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "stock_movements_componentId_locationId_idx" ON "stock_movements"("componentId", "locationId");

-- CreateIndex
CREATE INDEX "stock_movements_documentId_idx" ON "stock_movements"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "item_stock_balances_componentId_locationId_key" ON "item_stock_balances"("componentId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "item_cost_states_componentId_key" ON "item_cost_states"("componentId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "charge_records_number_key" ON "charge_records"("number");

-- CreateIndex
CREATE UNIQUE INDEX "charge_records_chargeNo_key" ON "charge_records"("chargeNo");

-- CreateIndex
CREATE UNIQUE INDEX "charge_records_postedDocumentId_key" ON "charge_records"("postedDocumentId");

-- CreateIndex
CREATE INDEX "charge_records_documentId_idx" ON "charge_records"("documentId");

-- CreateIndex
CREATE INDEX "charge_records_status_idx" ON "charge_records"("status");


-- Append-only records (Report 11 A-01): corrections are made by reversal entries, never by editing or deleting history
CREATE TRIGGER "audit_logs_no_update" BEFORE UPDATE ON "audit_logs" BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER "audit_logs_no_delete" BEFORE DELETE ON "audit_logs" BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER "journal_entries_no_update" BEFORE UPDATE ON "journal_entries" BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only'); END;
CREATE TRIGGER "journal_entries_no_delete" BEFORE DELETE ON "journal_entries" BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only'); END;
CREATE TRIGGER "journal_lines_no_update" BEFORE UPDATE ON "journal_lines" BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only'); END;
CREATE TRIGGER "journal_lines_no_delete" BEFORE DELETE ON "journal_lines" BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only'); END;
CREATE TRIGGER "stock_movements_no_update" BEFORE UPDATE ON "stock_movements" BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
CREATE TRIGGER "stock_movements_no_delete" BEFORE DELETE ON "stock_movements" BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
