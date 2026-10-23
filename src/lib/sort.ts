// src/lib/sort.ts
// Strict, whitelist-based dynamic sorting for Phase 7.x

export type SortOrder = "asc" | "desc";

export interface SortConfig {
  sortField: string;
  sortOrder: SortOrder;
}

/**
 * Extracts and validates the sort parameters from the URL searchParams.
 */
export function parseSortParams(params: URLSearchParams | { [key: string]: string | undefined }): SortConfig | null {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const sortField = getParam("sort");
  const sortOrderRaw = getParam("order");

  if (!sortField) return null;

  // Validate order (default to desc if invalid)
  const sortOrder: SortOrder = sortOrderRaw === "asc" ? "asc" : "desc";

  return { sortField, sortOrder };
}

/**
 * Safely builds the Prisma `orderBy` object using a strict whitelist.
 * If the requested sort field is not in the whitelist, it falls back to the default ordering.
 */
export function buildOrderBy(
  sortConfig: SortConfig | null,
  whitelist: Record<string, string>,
  defaultOrder: any
): any {
  if (!sortConfig) return defaultOrder;

  const { sortField, sortOrder } = sortConfig;
  const dbFieldPath = whitelist[sortField];

  if (!dbFieldPath) {
    // Invalid or hacky field requested (e.g. ?sort=password) -> Fallback safely
    return defaultOrder;
  }

  // Handle relational paths (e.g. 'customer.name' -> { customer: { name: 'asc' } })
  if (dbFieldPath.includes('.')) {
    const parts = dbFieldPath.split('.');
    if (parts.length === 2) {
      return { [parts[0]]: { [parts[1]]: sortOrder } };
    }
  }

  return { [dbFieldPath]: sortOrder };
}

// ==========================================
// MODULE SPECIFIC WHITELISTS
// ==========================================

export const SALES_SORT_WHITELIST = {
  date: "createdAt",
  invoiceNumber: "invoiceNumber",
  customer: "customer.name",
  total: "total",
  paymentStatus: "paymentStatus"
};

export const PURCHASES_SORT_WHITELIST = {
  date: "createdAt",
  poNumber: "poNumber",
  supplier: "supplier.name",
  total: "total",
  paymentStatus: "paymentStatus"
};

export const INVENTORY_SORT_WHITELIST = {
  name: "name",
  sku: "sku",
  category: "category.name",
  quantity: "quantity",
  price: "unitPrice",
  cost: "unitCost"
};

export const CUSTOMERS_SORT_WHITELIST = {
  name: "name",
  phone: "phone",
  email: "email",
  date: "createdAt"
};

export const SUPPLIERS_SORT_WHITELIST = {
  name: "name",
  company: "company",
  phone: "phone",
  email: "email",
  date: "createdAt"
};

export const FINANCE_SORT_WHITELIST = {
  date: "date",
  amount: "amount",
  type: "type",
  reference: "transactionRef"
};

export const EXPENDITURES_SORT_WHITELIST = {
  date: "date",
  amount: "amount",
  category: "category"
};

export const ACCOUNTS_SORT_WHITELIST = {
  name: "name",
  type: "type",
  bank: "bankName"
};

export const DAYBOOK_SORT_WHITELIST = {
  date: "date",
  amount: "amount",
  type: "type",
  reference: "reference"
};

export const CUSTOMER_PAYMENTS_SORT_WHITELIST = {
  date: "date",
  customer: "customer.name",
  amount: "amount"
};

export const SUPPLIER_PAYMENTS_SORT_WHITELIST = {
  date: "date",
  supplier: "supplier.name",
  amount: "amount"
};
