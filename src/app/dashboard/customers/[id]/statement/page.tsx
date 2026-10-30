// src/app/dashboard/customers/[id]/statement/page.tsx - Customer statement from Books (Report 28 §5).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSetting } from "@/lib/accounting/setup";
import { customerStatement } from "@/lib/sales/statement";
import StatementClient from "./statement-client";

export default async function CustomerStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "customers", "read")) redirect("/dashboard");
  const { id } = await params;
  const { from, to } = await searchParams;
  const st = await customerStatement(prisma, id, { from, to });
  if (!st) return <div className="p-10 text-center">Customer not found</div>;
  const businessName = (await getSetting(prisma, "BUSINESS_NAME")) || "Paper Mill ERP";
  return <StatementClient statement={st} businessName={businessName} />;
}
