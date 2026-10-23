-- AlterTable
ALTER TABLE "components" ADD COLUMN "dimensionX" REAL;
ALTER TABLE "components" ADD COLUMN "dimensionY" REAL;
ALTER TABLE "components" ADD COLUMN "divisor" REAL DEFAULT 15500;
ALTER TABLE "components" ADD COLUMN "gsm" REAL;
ALTER TABLE "components" ADD COLUMN "ratePerKg" REAL;
ALTER TABLE "components" ADD COLUMN "rimInSheet" INTEGER DEFAULT 100;
ALTER TABLE "components" ADD COLUMN "weightKg" REAL;

-- CreateIndex
CREATE INDEX "components_categoryId_idx" ON "components"("categoryId");

-- CreateIndex
CREATE INDEX "components_supplierId_idx" ON "components"("supplierId");

-- CreateIndex
CREATE INDEX "components_sku_idx" ON "components"("sku");

-- CreateIndex
CREATE INDEX "finances_type_idx" ON "finances"("type");

-- CreateIndex
CREATE INDEX "finances_category_idx" ON "finances"("category");

-- CreateIndex
CREATE INDEX "finances_date_idx" ON "finances"("date");

-- CreateIndex
CREATE INDEX "finances_userId_idx" ON "finances"("userId");

-- CreateIndex
CREATE INDEX "finances_transactionRef_idx" ON "finances"("transactionRef");

-- CreateIndex
CREATE INDEX "purchase_items_purchaseId_idx" ON "purchase_items"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_items_componentId_idx" ON "purchase_items"("componentId");

-- CreateIndex
CREATE INDEX "purchases_supplierId_idx" ON "purchases"("supplierId");

-- CreateIndex
CREATE INDEX "purchases_paymentStatus_idx" ON "purchases"("paymentStatus");

-- CreateIndex
CREATE INDEX "purchases_createdAt_idx" ON "purchases"("createdAt");

-- CreateIndex
CREATE INDEX "purchases_poNumber_idx" ON "purchases"("poNumber");

-- CreateIndex
CREATE INDEX "sale_items_saleId_idx" ON "sale_items"("saleId");

-- CreateIndex
CREATE INDEX "sale_items_componentId_idx" ON "sale_items"("componentId");

-- CreateIndex
CREATE INDEX "sales_customerId_idx" ON "sales"("customerId");

-- CreateIndex
CREATE INDEX "sales_paymentStatus_idx" ON "sales"("paymentStatus");

-- CreateIndex
CREATE INDEX "sales_createdAt_idx" ON "sales"("createdAt");

-- CreateIndex
CREATE INDEX "sales_invoiceNumber_idx" ON "sales"("invoiceNumber");

