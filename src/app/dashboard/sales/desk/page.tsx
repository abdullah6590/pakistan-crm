// src/app/dashboard/sales/desk/page.tsx - The Customer Invoice and Cash Sale desks (Report 33): one window as in the old
// program. It opens on the last bill, locked; << < > >> and Find show other bills in the same window; New starts a
// bill; Edit unlocks the shown bill (with a reason); Print, Print G (slip) and, on a part-paid cash sale, Cash Update.
import { redirect } from "next/navigation";
import { catalogReady } from "@/lib/accounting/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { invoicePayments } from "@/lib/accounting/receivables";
import { mayEditBill } from "@/lib/sales/books-sales";
import { stepBill } from "@/lib/sales/step";
import { screenBill, startingLists } from "@/lib/sales/desk-data";
import PaperSaleClient from "../new/paper-sale-client";

export const dynamic = "force-dynamic";

export default async function SaleDeskPage({ searchParams }: { searchParams: Promise<{ kind?: string; id?: string; new?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "sales", "read")) redirect("/dashboard");
  await catalogReady();
  const sp = await searchParams;
  const kind = sp.kind === "cash" ? "CASH_SALE" : "SALE_INVOICE";
  const lists = await startingLists(prisma);
  const canWrite = can(user.role, "sales", "write");

  // Which bill: the one asked for, else the last of this kind (as the old screens opened), else a new one
  const id = sp.new === "1" ? null : sp.id ?? (await stepBill(prisma, kind, "last"))?.id ?? null;
  const bill = id ? await loadBooksBill(prisma, id) : null;
  if (!bill || (bill.doc.type !== "SALE_INVOICE" && bill.doc.type !== "CASH_SALE")) {
    if (!canWrite) redirect("/dashboard/sales");
    return <PaperSaleClient key={`new-${kind}`} {...lists} startWalkIn={kind === "CASH_SALE"} desk={{ kind }} />;
  }
  const { doc } = bill;
  const current = doc.status === "POSTED";
  const pays = await invoicePayments(prisma, doc.id);
  const payments = [
    ...(Number(pays.atCounter) > 0 ? [{ docNo: doc.docNo, date: doc.date.toISOString(), method: "At the counter", amount: String(pays.atCounter) }] : []),
    ...pays.payments.map((p) => ({ docNo: p.receiptNo, date: new Date(p.date).toISOString(), method: p.method, amount: String(p.amount) })),
  ];
  return (
    <PaperSaleClient
      key={doc.id}
      {...lists}
      editBill={await screenBill(prisma, bill)}
      desk={{
        kind: doc.type as "SALE_INVOICE" | "CASH_SALE",
        locked: true,
        status: doc.status,
        printCount: doc.printCount,
        lastPrintedAt: doc.lastPrintedAt ? doc.lastPrintedAt.toISOString() : null,
        total: bill.total, paid: bill.paid, remaining: bill.remaining,
        previousBalance: doc.previousBalance, newBalance: doc.newBalance,
        canEdit: current && canWrite && mayEditBill({ id: user.id, role: user.role }, doc),
        canCashUpdate: current && doc.type === "CASH_SALE" && Number(bill.remaining) > 0 && can(user.role, "customerPayments", "write"),
        canPay: current && Number(bill.remaining) > 0 && can(user.role, "customerPayments", "write"),
        payments,
        canNew: canWrite,
      }}
    />
  );
}
