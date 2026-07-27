// src/app/dashboard/expenditures/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import ExpendituresClient from "./expenditures-client";

export default async function ExpendituresPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const expenditures = await prisma.expenditure.findMany({
    orderBy: { date: "desc" },
    take: 200,
  });

  const accounts = await prisma.financialAccount.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true },
  });

  const categoryTotals = await prisma.expenditure.groupBy({
    by: ["category"],
    _sum: { amount: true },
    _count: true,
  });

  const totalExpense = expenditures.reduce((s, e) => s + e.amount, 0);

  return (
    <ExpendituresClient
      expenditures={JSON.parse(JSON.stringify(expenditures))}
      accounts={accounts}
      categoryBreakdown={categoryTotals.map(c => ({ category: c.category, total: c._sum.amount || 0, count: c._count }))}
      totalExpense={totalExpense}
    />
  );
}
