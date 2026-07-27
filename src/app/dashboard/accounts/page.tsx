// src/app/dashboard/accounts/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import AccountsClient from "./accounts-client";

export default async function AccountsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const accounts = await prisma.financialAccount.findMany({
    orderBy: { createdAt: "desc" },
  });

  const totalBalance = accounts.reduce((s, a) => s + a.currentBalance, 0);
  const bankBalance = accounts.filter(a => a.type === "BANK").reduce((s, a) => s + a.currentBalance, 0);
  const cashBalance = accounts.filter(a => a.type === "CASH").reduce((s, a) => s + a.currentBalance, 0);
  const walletBalance = accounts.filter(a => a.type === "DIGITAL_WALLET").reduce((s, a) => s + a.currentBalance, 0);

  return (
    <AccountsClient
      accounts={JSON.parse(JSON.stringify(accounts))}
      summary={{ totalBalance, bankBalance, cashBalance, walletBalance }}
    />
  );
}
