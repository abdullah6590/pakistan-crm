// src/app/(dashboard)/customers/page.tsx - Customers (Server)
import { catalogReady } from "@/lib/accounting/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustomersClient from "./customers-client";
import { partyMoney, partyMoneyTotals } from "@/lib/accounting/books-reports";
import { buildCustomersWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, CUSTOMERS_SORT_WHITELIST } from "@/lib/sort";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const user = await getAuthUser();
  await catalogReady(); // product and party numbers (Report 32 phase 1)
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildCustomersWhere(params as any);
  
  const sortConfig = parseSortParams(params as any);
  const orderByClause = buildOrderBy(sortConfig, CUSTOMERS_SORT_WHITELIST, { name: "asc" });

  const [customers, totalCustomers] = await Promise.all([
    prisma.customer.findMany({
      where: whereClause,
      take: limit,
      skip,
      include: { _count: { select: { sales: true } } },
      orderBy: orderByClause,
    }),
    prisma.customer.count({ where: whereClause })
  ]);

  const totalPages = Math.ceil(totalCustomers / limit);

  // Billed, paid and balance of each customer on this page, and of all customers together, from Books
  const parties = await prisma.ledgerAccount.findMany({ where: { customerId: { in: customers.map((c) => c.id) } }, select: { id: true, customerId: true } });
  const money = await partyMoney(prisma, parties.map((p) => p.id), "CUSTOMER");
  const byCustomer = new Map(parties.map((p) => [p.customerId!, money.get(p.id) ?? null]));
  const totals = await partyMoneyTotals(prisma, "CUSTOMER");
  // Bills on Books (the Orders column counted only bills of the older screens)
  const bookBills = await prisma.accountingDocument.groupBy({
    by: ["partyAccountId"], where: { partyAccountId: { in: parties.map((p) => p.id) }, type: { in: ["SALE_INVOICE", "CASH_SALE"] }, status: "POSTED" }, _count: true,
  });
  const billsOf = new Map(bookBills.map((b) => [b.partyAccountId!, b._count]));
  const billsByCustomer = new Map(parties.map((p) => [p.customerId!, billsOf.get(p.id) ?? 0]));

  return (
    <CustomersClient 
      customers={JSON.parse(JSON.stringify(customers.map((c) => ({ ...c, money: byCustomer.get(c.id) ?? null, _count: { sales: c._count.sales + (billsByCustomer.get(c.id) ?? 0) } }))))}
      totals={totals}
      pagination={{ page, totalPages, totalRecords: totalCustomers }} 
    />
  );
}