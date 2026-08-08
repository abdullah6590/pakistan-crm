// src/app/dashboard/accounts/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import AccountsClient from "./accounts-client";
import { buildAccountsWhere } from "@/lib/filters";

export default async function AccountsPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const whereClause = buildAccountsWhere(params as any);

  const [accounts, allAccountsForSummary] = await Promise.all([
    prisma.financialAccount.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    }),
    prisma.financialAccount.findMany({
      orderBy: { createdAt: "desc" },
    })
  ]);

  const totalBalance = allAccountsForSummary.reduce((s, a) => s + a.currentBalance, 0);
  const bankBalance = allAccountsForSummary.filter(a => a.type === "BANK").reduce((s, a) => s + a.currentBalance, 0);
  const cashBalance = allAccountsForSummary.filter(a => a.type === "CASH").reduce((s, a) => s + a.currentBalance, 0);
  const walletBalance = allAccountsForSummary.filter(a => a.type === "DIGITAL_WALLET").reduce((s, a) => s + a.currentBalance, 0);

  return (
    <AccountsClient
      accounts={JSON.parse(JSON.stringify(accounts))}
      summary={{ totalBalance, bankBalance, cashBalance, walletBalance }}
    />
  );
}
