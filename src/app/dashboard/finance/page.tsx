// src/app/(dashboard)/finance/page.tsx - Finance (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import FinanceClient from "./finance-client";
import { buildFinanceWhere } from "@/lib/filters";

export default async function FinancePage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildFinanceWhere(params as any);

  const [records, totalRecordsCount, incomeAgg, expenseAgg] = await Promise.all([
    prisma.finance.findMany({
      where: whereClause,
      include: { user: { select: { name: true } } },
      orderBy: { date: "desc" },
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