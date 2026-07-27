// src/app/dashboard/customers/[id]/ledger/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustomerLedgerClient from "./ledger-client";

export default async function CustomerLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <CustomerLedgerClient customerId={id} />;
}
