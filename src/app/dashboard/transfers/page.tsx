// src/app/dashboard/transfers/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import TransfersClient from "./transfers-client";

export default async function TransfersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const transfers = await prisma.accountTransfer.findMany({
    include: {
      fromAccount: { select: { id: true, name: true, type: true } },
      toAccount: { select: { id: true, name: true, type: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  const accounts = await prisma.financialAccount.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true, currentBalance: true },
  });

  return (
    <TransfersClient
      transfers={JSON.parse(JSON.stringify(transfers))}
      accounts={JSON.parse(JSON.stringify(accounts))}
    />
  );
}
