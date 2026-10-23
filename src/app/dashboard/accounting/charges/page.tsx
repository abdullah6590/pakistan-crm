// src/app/dashboard/accounting/charges/page.tsx - Freight, loading, bilty and printing charges (2026-10-22 rules).
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { listCharges } from "@/lib/accounting/charges";
import { accountingReady } from "@/lib/accounting/server";
import { getSetting } from "@/lib/accounting/setup";
import { PageHeader } from "@/components/shared/page-header";
import ChargesClient from "./charges-client";

export default async function ChargesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "charges", "read")) redirect("/dashboard/accounting");
  await accountingReady();
  const sp = await searchParams;

  const [charges, accounts, documents, dateFormat] = await Promise.all([
    listCharges(prisma, { status: sp.status, kind: sp.kind }),
    prisma.ledgerAccount.findMany({ where: { isActive: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.accountingDocument.findMany({
      where: { type: { in: ["PURCHASE_INVOICE", "PRESS_DISPATCH", "PRESS_RECEIPT", "PRESS_RETURN"] }, status: "POSTED" },
      select: { id: true, docNo: true, type: true, partyAccountId: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    getSetting(prisma, "DATE_FORMAT"),
  ]);
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Charges"
        description="Freight, loading, bilty and printing charges. Recording a charge never posts to the accounts; you choose whether to post it as an expense."
        icon={Receipt}
      />
      <ChargesClient
        dateFormat={dateFormat}
        filter={{ status: sp.status ?? "", kind: sp.kind ?? "" }}
        canRecord={can(user.role, "charges", "write")}
        canCancel={can(user.role, "charges", "delete")}
        canPost={can(user.role, "chargePosting", "write")}
        canReverse={can(user.role, "chargePosting", "delete")}
        charges={charges.map((c) => ({
          id: c.id, chargeNo: c.chargeNo, kind: c.kind, date: c.date.toISOString(), amount: c.amount, description: c.description,
          reference: c.reference, status: c.status, partyName: c.partyAccountId ? names.get(c.partyAccountId) ?? null : null, partyAccountId: c.partyAccountId,
          document: c.document, postings: c.postings.map((p) => ({ id: p.id, docNo: p.docNo, status: p.status })),
        }))}
        accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, subType: a.subType }))}
        documents={documents}
      />
    </div>
  );
}
