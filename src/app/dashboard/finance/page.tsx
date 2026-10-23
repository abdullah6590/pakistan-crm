// src/app/(dashboard)/finance/page.tsx - Finance (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import FinanceClient from "./finance-client";
import { buildFinanceWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, FINANCE_SORT_WHITELIST } from "@/lib/sort";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildFinanceWhere(params as any);
  
  const sortConfig = parseSortParams(params as any);
  const orderByClause = buildOrderBy(sortConfig, FINANCE_SORT_WHITELIST, { date: "desc" });

  const [records, totalRecordsCount, incomeAgg, expenseAgg] = await Promise.all([
    prisma.finance.findMany({
      where: whereClause,
      include: { user: { select: { name: true } } },
      orderBy: orderByClause,
      skip,
      take: limit,
    }),
    prisma.finance.count({ where: whereClause }),
    prisma.finance.aggregate({ _sum: { amount: true }, where: { ...whereClause, type: "INCOME" } }),
    prisma.finance.aggregate({ _sum: { amount: true }, where: { ...whereClause, type: "EXPENSE" } }),
  ]);

  const totalPages = Math.ceil(totalRecordsCount / limit);

  const summary = {
    totalIncome: incomeAgg._sum.amount || 0,
    totalExpense: expenseAgg._sum.amount || 0,
    netProfit: (incomeAgg._sum.amount || 0) - (expenseAgg._sum.amount || 0),
  };

  return (
    <FinanceClient
      records={JSON.parse(JSON.stringify(records))}
      summary={summary}
      pagination={{ page, totalPages, totalRecords: totalRecordsCount }}
    />
  );
}