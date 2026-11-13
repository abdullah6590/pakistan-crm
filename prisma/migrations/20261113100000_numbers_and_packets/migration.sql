-- Phase 1 of the old-program parity work (Report 32, owner approval 2026-11-13).
-- Additive only: new nullable columns and unique indexes; no existing row is changed here.
-- Numbers and unit profiles for existing rows are filled by the main server at start (src/lib/catalog/ensure.ts),
-- never by this migration, so a syncing computer never numbers its own copy differently from the server.

-- Short product number (old "Product id") and the sale rate per kg (old "Sale Price"), independent of the
-- purchase rate per kg already held in "ratePerKg"
ALTER TABLE "components" ADD COLUMN "itemNo" INTEGER;
ALTER TABLE "components" ADD COLUMN "saleRatePerKg" REAL;
CREATE UNIQUE INDEX "components_itemNo_key" ON "components"("itemNo");

-- Short party number: one sequence shared by customers and suppliers (old SubAccount.SubCode)
ALTER TABLE "customers" ADD COLUMN "partyNo" INTEGER;
CREATE UNIQUE INDEX "customers_partyNo_key" ON "customers"("partyNo");
ALTER TABLE "suppliers" ADD COLUMN "partyNo" INTEGER;
CREATE UNIQUE INDEX "suppliers_partyNo_key" ON "suppliers"("partyNo");

-- Item Group price: the default purchase rate per kg for the group's products (old PG.Pprice)
ALTER TABLE "component_categories" ADD COLUMN "ratePerKg" REAL;
