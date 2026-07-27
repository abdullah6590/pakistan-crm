-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "chequeNumber" TEXT,
    "bankName" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "purchaseId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "chequeNumber" TEXT,
    "bankName" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "saleId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cash_sales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptNo" TEXT NOT NULL,
    "customerName" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" REAL NOT NULL,
    "remarks" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "currentBalance" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "account_transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "transferType" TEXT NOT NULL,
    "voucherNumber" TEXT,
    "notes" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "financial_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "account_transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "financial_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "expenditures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
INSERT INTO "new_components" ("categoryId", "createdAt", "datasheetUrl", "description", "id", "imageUrl", "isActive", "lastPurchasedAt", "lastSoldAt", "location", "minQuantity", "name", "quantity", "sku", "supplierId", "totalDamaged", "totalPurchased", "totalSold", "totalUsed", "unitCost", "unitPrice", "updatedAt") SELECT "categoryId", "createdAt", "datasheetUrl", "description", "id", "imageUrl", "isActive", "lastPurchasedAt", "lastSoldAt", "location", "minQuantity", "name", "quantity", "sku", "supplierId", "totalDamaged", "totalPurchased", "totalSold", "totalUsed", "unitCost", "unitPrice", "updatedAt" FROM "components";
DROP TABLE "components";
ALTER TABLE "new_components" RENAME TO "components";
CREATE UNIQUE INDEX "components_sku_key" ON "components"("sku");
CREATE TABLE "new_customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "totalPurchased" REAL NOT NULL DEFAULT 0,
    "balanceDue" REAL NOT NULL DEFAULT 0,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_customers" ("address", "city", "createdAt", "email", "id", "isActive", "name", "notes", "phone", "totalPurchased", "updatedAt", "visitCount") SELECT "address", "city", "createdAt", "email", "id", "isActive", "name", "notes", "phone", "totalPurchased", "updatedAt", "visitCount" FROM "customers";
DROP TABLE "customers";
ALTER TABLE "new_customers" RENAME TO "customers";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "cash_sales_receiptNo_key" ON "cash_sales"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_name_key" ON "financial_accounts"("name");
