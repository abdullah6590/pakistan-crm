// src/app/dashboard/daybook/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import DaybookClient from "./daybook-client";

export default async function DaybookPage(props: { searchParams: Promise<{ section?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;
  const section = searchParams.section || "finance";

  // We rely heavily on the client fetching the data dynamically via the Daybook API
  // but we can pass initial server-side data for the default "finance" view to speed up initial load.

  const initialAccounts = await prisma.financialAccount.findMany({
    where: { isActive: true },
  });

  return (
    <DaybookClient 
      initialSection={section as "finance" | "supplier" | "customer"} 
      initialAccounts={JSON.parse(JSON.stringify(initialAccounts))}
    />
  );
}
