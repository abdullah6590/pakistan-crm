// src/app/dashboard/expenditures/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import ExpendituresClient from "./expenditures-client";
import { buildExpendituresWhere } from "@/lib/filters";

export default async function ExpendituresPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt((params as any).page || "1", 10);
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildExpendituresWhere(params as any);

  const [expenditures, totalExpenditures, accounts, categoryTotals, totalExpenseAggregate] = await Promise.all([
    prisma.expenditure.findMany({
      where: whereClause,
      orderBy: { date: "desc" },
      take: limit,
      skip,
    }),
    prisma.expenditure.count({ where: whereClause }),
    prisma.financialAccount.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true },
    }),
    prisma.expenditure.groupBy({
      by: ["category"],
      where: whereClause,
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expenditure.aggregate({
      where: whereClause,
      _sum: { amount: true },
    })
  ]);

  const totalExpense = totalExpenseAggregate._sum.amount || 0;
  const totalPages = Math.ceil(totalExpenditures / limit);

  return (
    <ExpendituresClient
      expenditures={JSON.parse(JSON.stringify(expenditures))}
      accounts={accounts}
      categoryBreakdown={categoryTotals.map(c => ({ category: c.category, total: c._sum.amount || 0, count: c._count }))}
      totalExpense={totalExpense}
      pagination={{ page, totalPages, totalRecords: totalExpenditures }}
    />
  );
}
