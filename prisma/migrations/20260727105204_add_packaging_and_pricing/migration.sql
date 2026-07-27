-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_components" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 5,
    "packagingUnit" TEXT NOT NULL DEFAULT 'Carton',
    "itemsPerPackage" INTEGER NOT NULL DEFAULT 1,
    "supplierPrice" REAL NOT NULL DEFAULT 0,
    "expenses" REAL NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "location" TEXT,
    "datasheetUrl" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "size" TEXT,
    "grams" REAL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "customFields" TEXT,
    "totalPurchased" INTEGER NOT NULL DEFAULT 0,
    "totalUsed" INTEGER NOT NULL DEFAULT 0,
    "totalSold" INTEGER NOT NULL DEFAULT 0,
    "totalDamaged" INTEGER NOT NULL DEFAULT 0,
    "lastPurchasedAt" DATETIME,
    "lastSoldAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "components_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "component_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "components_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_components" ("categoryId", "createdAt", "customFields", "datasheetUrl", "description", "grams", "id", "imageUrl", "isActive", "lastPurchasedAt", "lastSoldAt", "location", "minQuantity", "name", "quantity", "size", "sku", "supplierId", "totalDamaged", "totalPurchased", "totalSold", "totalUsed", "unit", "unitCost", "unitPrice", "updatedAt") SELECT "categoryId", "createdAt", "customFields", "datasheetUrl", "description", "grams", "id", "imageUrl", "isActive", "lastPurchasedAt", "lastSoldAt", "location", "minQuantity", "name", "quantity", "size", "sku", "supplierId", "totalDamaged", "totalPurchased", "totalSold", "totalUsed", "unit", "unitCost", "unitPrice", "updatedAt" FROM "components";
DROP TABLE "components";
ALTER TABLE "new_components" RENAME TO "components";
CREATE UNIQUE INDEX "components_sku_key" ON "components"("sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
