// src/app/(dashboard)/finance/page.tsx - Finance (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import FinanceClient from "./finance-client";

export default async function FinancePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const [records, incomeAgg, expenseAgg] = await Promise.all([
    prisma.finance.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "INCOME" } }),
    prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE" } }),
  ]);

  const summary = {
    totalIncome: incomeAgg._sum.amount || 0,
    totalExpense: expenseAgg._sum.amount || 0,
    netProfit: (incomeAgg._sum.amount || 0) - (expenseAgg._sum.amount || 0),
  };

  return (
    <FinanceClient
      records={JSON.parse(JSON.stringify(records))}
      summary={summary}
    />
  );
}