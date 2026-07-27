// src/app/dashboard/suppliers/[id]/ledger/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SupplierLedgerClient from "./ledger-client";

export default async function SupplierLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  return <SupplierLedgerClient supplierId={id} />;
}
