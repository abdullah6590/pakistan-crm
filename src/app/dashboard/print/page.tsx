import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { can, MODULE_RESOURCE } from "@/lib/permissions";
import { 
  buildSalesWhere, buildPurchasesWhere, buildInventoryWhere,
  buildCustomersWhere, buildSuppliersWhere, buildFinanceWhere,
  buildExpendituresWhere, buildAccountsWhere 
} from "@/lib/filters";
import { 
  parseSortParams, buildOrderBy,
  SALES_SORT_WHITELIST, PURCHASES_SORT_WHITELIST, INVENTORY_SORT_WHITELIST,
  CUSTOMERS_SORT_WHITELIST, SUPPLIERS_SORT_WHITELIST, FINANCE_SORT_WHITELIST,
  EXPENDITURES_SORT_WHITELIST, ACCOUNTS_SORT_WHITELIST
} from "@/lib/sort";
import PrintClient from "./print-client";

export default async function PrintPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const moduleName = params.module;
  
  // Each module requires the same read permission as its own page (audit SEC-06)
  const resource = moduleName ? MODULE_RESOURCE[moduleName] : undefined;
  if (moduleName && (!resource || !can(user.role, resource, "read"))) redirect("/dashboard");

  if (!moduleName) {
    return <div className="p-10 text-center">Module parameter is missing. Cannot print.</div>;
  }

  let data: any[] = [];
  const limit = 5000;
  
  const sortConfig = parseSortParams(params as any);

  switch (moduleName) {
    case "sales": {
      data = await prisma.sale.findMany({
        where: buildSalesWhere(params as any),
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: buildOrderBy(sortConfig, SALES_SORT_WHITELIST, { createdAt: "desc" }),
        take: limit,
      });
      break;
    }
    case "purchases": {
      data = await prisma.purchase.findMany({
        where: buildPurchasesWhere(params as any),
        include: { supplier: { select: { name: true, phone: true } } },
        orderBy: buildOrderBy(sortConfig, PURCHASES_SORT_WHITELIST, { createdAt: "desc" }),
        take: limit,
      });
      break;
    }
    case "inventory": {
      data = await prisma.component.findMany({
        where: buildInventoryWhere(params as any),
        include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
        orderBy: buildOrderBy(sortConfig, INVENTORY_SORT_WHITELIST, { name: "asc" }),
        take: limit,
      });
      break;
    }
    case "customers": {
      data = await prisma.customer.findMany({
        where: buildCustomersWhere(params as any),
        orderBy: buildOrderBy(sortConfig, CUSTOMERS_SORT_WHITELIST, { name: "asc" }),
        take: limit,
      });
      break;
    }
    case "suppliers": {
      data = await prisma.supplier.findMany({
        where: buildSuppliersWhere(params as any),
        orderBy: buildOrderBy(sortConfig, SUPPLIERS_SORT_WHITELIST, { name: "asc" }),
        take: limit,
      });
      break;
    }
    case "finance": {
      data = await prisma.finance.findMany({
        where: buildFinanceWhere(params as any),
        include: { user: { select: { name: true } } },
        orderBy: buildOrderBy(sortConfig, FINANCE_SORT_WHITELIST, { date: "desc" }),
        take: limit,
      });
      break;
    }
    case "expenditures": {
      data = await prisma.expenditure.findMany({
        where: buildExpendituresWhere(params as any),
        orderBy: buildOrderBy(sortConfig, EXPENDITURES_SORT_WHITELIST, { date: "desc" }),
        take: limit,
      });
      break;
    }
    case "accounts": {
      data = await prisma.financialAccount.findMany({
        where: buildAccountsWhere(params as any),
        orderBy: buildOrderBy(sortConfig, ACCOUNTS_SORT_WHITELIST, { name: "asc" }),
        take: limit,
      });
      break;
    }
    default:
      return <div className="p-10 text-center">Unknown module: {moduleName}</div>;
  }

  return (
    <PrintClient 
      moduleName={moduleName} 
      data={JSON.parse(JSON.stringify(data))} 
      params={params as any}
    />
  );
}
