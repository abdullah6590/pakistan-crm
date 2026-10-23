// src/app/dashboard/accounts/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import AccountsClient from "./accounts-client";
import { buildAccountsWhere } from "@/lib/filters";
import { parseSortParams, buildOrderBy, ACCOUNTS_SORT_WHITELIST } from "@/lib/sort";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const limit = 50;
  const skip = (page - 1) * limit;
  const whereClause = buildAccountsWhere(params as any);
  
  const sortConfig = parseSortParams(params as any);
  const orderByClause = buildOrderBy(sortConfig, ACCOUNTS_SORT_WHITELIST, { name: "asc" });

  const [accounts, allAccountsForSummary] = await Promise.all([
    prisma.financialAccount.findMany({
      where: whereClause,
      orderBy: orderByClause,
      skip,
      take: limit,
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
