import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { 
  buildSalesWhere, buildPurchasesWhere, buildInventoryWhere,
  buildCustomersWhere, buildSuppliersWhere, buildFinanceWhere,
  buildExpendituresWhere, buildAccountsWhere 
} from "@/lib/filters";
import PrintClient from "./print-client";

export default async function PrintPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const moduleName = params.module;
  
  if (!moduleName) {
    return <div className="p-10 text-center">Module parameter is missing. Cannot print.</div>;
  }

  let data: any[] = [];
  const limit = 5000;

  switch (moduleName) {
    case "sales": {
      data = await prisma.sale.findMany({
        where: buildSalesWhere(params as any),
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      break;
    }
    case "purchases": {
      data = await prisma.purchase.findMany({
        where: buildPurchasesWhere(params as any),
        include: { supplier: { select: { name: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      break;
    }
    case "inventory": {
      data = await prisma.component.findMany({
        where: buildInventoryWhere(params as any),
        include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
        orderBy: { name: "asc" },
        take: limit,
      });
      break;
    }
    case "customers": {
      data = await prisma.customer.findMany({
        where: buildCustomersWhere(params as any),
        orderBy: { name: "asc" },
        take: limit,
      });
      break;
    }
    case "suppliers": {
      data = await prisma.supplier.findMany({
        where: buildSuppliersWhere(params as any),
        orderBy: { name: "asc" },
        take: limit,
      });
      break;
    }
    case "finance": {
      data = await prisma.finance.findMany({
        where: buildFinanceWhere(params as any),
        include: { user: { select: { name: true } } },
        orderBy: { date: "desc" },
        take: limit,
      });
      break;
    }
    case "expenditures": {
      data = await prisma.expenditure.findMany({
        where: buildExpendituresWhere(params as any),
        orderBy: { date: "desc" },
        take: limit,
      });
      break;
    }
    case "accounts": {
      data = await prisma.financialAccount.findMany({
        where: buildAccountsWhere(params as any),
        orderBy: { name: "asc" },
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
