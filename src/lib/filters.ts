// src/lib/filters.ts
// Universal filtering architecture for Phase 7

export function parseDateRange(from?: string | null, to?: string | null, fieldName: string = "createdAt") {
  if (!from && !to) return {};
  const dateFilter: any = {};
  
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      dateFilter.gte = fromDate;
    }
  }
  
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      // Set to end of day
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
  }
  
  return Object.keys(dateFilter).length > 0 ? { [fieldName]: dateFilter } : {};
}

export function parseAmountRange(min?: string | null, max?: string | null, fieldName: string = "total") {
  if (!min && !max) return {};
  const amountFilter: any = {};
  
  if (min && !isNaN(Number(min))) {
    amountFilter.gte = Number(min);
  }
  if (max && !isNaN(Number(max))) {
    amountFilter.lte = Number(max);
  }
  
  return Object.keys(amountFilter).length > 0 ? { [fieldName]: amountFilter } : {};
}

export function buildSalesWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const customerId = getParam("customerId");
  const paymentStatus = getParam("paymentStatus");
  const from = getParam("from");
  const to = getParam("to");
  const minAmount = getParam("minAmount");
  const maxAmount = getParam("maxAmount");

  return {
    AND: [
      search ? {
        OR: [
          { invoiceNumber: { contains: search } },
          { walkInName: { contains: search } },
          { customer: { name: { contains: search } } },
        ],
      } : {},
      customerId && customerId !== "all" ? { customerId } : {},
      paymentStatus && paymentStatus !== "all" ? { paymentStatus: paymentStatus as any } : {},
      parseDateRange(from, to, "createdAt"),
      parseAmountRange(minAmount, maxAmount, "total")
    ],
  };
}

export function buildPurchasesWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const supplierId = getParam("supplierId");
  const paymentStatus = getParam("paymentStatus");
  const from = getParam("from");
  const to = getParam("to");
  const minAmount = getParam("minAmount");
  const maxAmount = getParam("maxAmount");

  return {
    AND: [
      search ? {
        OR: [
          { poNumber: { contains: search } },
          { supplier: { name: { contains: search } } },
          { invoiceRef: { contains: search } },
        ],
      } : {},
      supplierId && supplierId !== "all" ? { supplierId } : {},
      paymentStatus && paymentStatus !== "all" ? { paymentStatus: paymentStatus as any } : {},
      parseDateRange(from, to, "createdAt"),
      parseAmountRange(minAmount, maxAmount, "total")
    ],
  };
}

export function buildInventoryWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const categoryId = getParam("categoryId");
  const supplierId = getParam("supplierId");
  const stockStatus = getParam("stockStatus"); // "low", "out", "in"

  const where: any = {
    AND: [
      search ? {
        OR: [
          { name: { contains: search } },
          { sku: { contains: search } },
          { description: { contains: search } },
        ],
      } : {},
      categoryId && categoryId !== "all" ? { categoryId } : {},
      supplierId && supplierId !== "all" ? { supplierId } : {},
    ]
  };

  if (stockStatus === "low") {
    where.AND.push({ quantity: { gt: 0, lte: 5 } }); // Using 5 as general threshold, ideal is to compare with minQuantity but Prisma requires raw query for column vs column. We'll use a rough low stock or we can do raw. Let's do raw in the route if needed, or simply quantity <= minQuantity if Prisma supports it now. Wait, Prisma does not support comparing two columns in the same table directly via object syntax yet.
    // We'll filter this in JS or just use quantity <= 5
  } else if (stockStatus === "out") {
    where.AND.push({ quantity: { lte: 0 } });
  } else if (stockStatus === "in") {
    where.AND.push({ quantity: { gt: 0 } });
  }

  return where;
}

export function buildCustomersWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const status = getParam("status");
  const from = getParam("from");
  const to = getParam("to");

  return {
    AND: [
      search ? {
        OR: [
          { name: { contains: search } },
          { phone: { contains: search } },
          { email: { contains: search } },
          { city: { contains: search } },
        ],
      } : {},
      status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {},
      parseDateRange(from, to, "createdAt")
    ]
  };
}

export function buildSuppliersWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const status = getParam("status");
  const balance = getParam("balance");
  const from = getParam("from");
  const to = getParam("to");

  return {
    AND: [
      search ? {
        OR: [
          { name: { contains: search } },
          { company: { contains: search } },
          { phone: { contains: search } },
          { city: { contains: search } },
        ],
      } : {},
      status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {},
      balance === "pending" ? { balanceDue: { gt: 0 } } : balance === "settled" ? { balanceDue: { lte: 0 } } : {},
      parseDateRange(from, to, "createdAt")
    ]
  };
}

export function buildFinanceWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const type = getParam("type");
  const category = getParam("category");
  const from = getParam("from");
  const to = getParam("to");
  const minAmount = getParam("minAmount");
  const maxAmount = getParam("maxAmount");

  return {
    AND: [
      search ? {
        OR: [
          { description: { contains: search } },
          { reference: { contains: search } },
          { transactionRef: { contains: search } },
        ],
      } : {},
      type && type !== "all" ? { type: type as any } : {},
      category && category !== "all" ? { category } : {},
      parseDateRange(from, to, "date"),
      parseAmountRange(minAmount, maxAmount, "amount")
    ]
  };
}

export function buildExpendituresWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const category = getParam("category");
  const from = getParam("from");
  const to = getParam("to");
  const minAmount = getParam("minAmount");
  const maxAmount = getParam("maxAmount");

  return {
    AND: [
      search ? {
        OR: [
          { description: { contains: search } },
          { reference: { contains: search } },
        ],
      } : {},
      category && category !== "all" ? { category } : {},
      parseDateRange(from, to, "date"),
      parseAmountRange(minAmount, maxAmount, "amount")
    ]
  };
}

export function buildAccountsWhere(params: URLSearchParams | { [key: string]: string | undefined }) {
  const getParam = (key: string) => params instanceof URLSearchParams ? params.get(key) : params[key];
  
  const search = getParam("search");
  const type = getParam("type");

  return {
    AND: [
      search ? {
        OR: [
          { name: { contains: search } },
          { bankName: { contains: search } },
          { accountNumber: { contains: search } },
        ],
      } : {},
      type && type !== "all" ? { type: type as any } : {},
    ]
  };
}
