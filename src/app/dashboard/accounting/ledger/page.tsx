// src/app/dashboard/accounting/ledger/page.tsx - Account statement in the legacy E01 layout (Report 14 §6, F-05).
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { accountStatement } from "@/lib/accounting/queries";
import { getSetting } from "@/lib/accounting/setup";
import { money, qty, drCr, formatDate, printDate } from "@/lib/accounting/meta";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import PrintButton from "../print-button";

const cell = "border-b border-dotted border-gray-400 px-2 py-1";
const num = `${cell} text-right tabular-nums`;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "ledgers", "read")) redirect("/dashboard/accounting");
  const sp = await searchParams;

  const accounts = await prisma.ledgerAccount.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] });
  const statement = sp.account
    ? await accountStatement(prisma, sp.account, { from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : undefined })
    : null;
  const dateFormat = await getSetting(prisma, "DATE_FORMAT");
  const businessName = await getSetting(prisma, "BUSINESS_NAME");

  return (
    <div className="space-y-6">
      <PageHeader title="Account statement" description="Opening balance, every document with item lines, and the running balance" icon={BookOpen} actions={statement && <PrintButton />} />
      <Card className="print:hidden">
        <CardContent className="p-4">
          <form className="grid gap-2 md:grid-cols-5">
            <select name="account" defaultValue={sp.account ?? ""} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm md:col-span-2" required>
              <option value="">Choose an account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.isActive ? "" : " (inactive)"}</option>)}
            </select>
            <Input name="from" type="date" defaultValue={sp.from ?? ""} />
            <Input name="to" type="date" defaultValue={sp.to ?? ""} />
            <button className={buttonVariants({})} type="submit">Show</button>
          </form>
        </CardContent>
      </Card>

      {statement && (
        <div className="rounded-lg border bg-white p-6 text-black print:border-0 print:p-0">
          <div className="text-xs">{printDate()}</div>
          {businessName && <div className="text-center text-lg font-bold">{businessName}</div>}
          <div className="text-center font-semibold">
            {statement.account.code} {statement.account.name}{statement.account.phone ? ` ${statement.account.phone}` : ""}
          </div>
          <div className="text-center text-xs">
            {sp.from ? formatDate(sp.from, dateFormat) : "Beginning"} to {sp.to ? formatDate(sp.to, dateFormat) : "today"}
          </div>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black">
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">Ref</th>
                <th className="px-2 py-1 text-left">Particulars</th>
                <th className="px-2 py-1 text-right">Rate</th>
                <th className="px-2 py-1 text-right">Catan</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Debit</th>
                <th className="px-2 py-1 text-right">Credit</th>
                <th className="px-2 py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cell}>{sp.from ? formatDate(sp.from, dateFormat) : ""}</td>
                <td className={cell}>Opn</td>
                <td className={cell}>Opening balance (B/F)</td>
                <td className={num}>-</td><td className={num}>-</td><td className={num}>-</td><td className={num}>-</td><td className={num}>-</td>
                <td className={num}>{drCr(statement.opening)}</td>
              </tr>
              {statement.rows.map((r, i) => {
                const ref = <Link className="text-primary print:text-black" href={`/dashboard/accounting/documents/${r.documentId}`}>{r.docNo}</Link>;
                const label = r.entryKind === "REVERSAL" ? `Cancelled: ${r.memo ?? ""}` : r.remarks ?? r.memo ?? "";
                if (r.items.length === 0) {
                  return (
                    <tr key={i}>
                      <td className={cell}>{formatDate(r.date, dateFormat)}</td>
                      <td className={cell}>{ref}</td>
                      <td className={cell}>{label}</td>
                      <td className={num}>-</td><td className={num}>-</td><td className={num}>-</td>
                      <td className={num}>{money(r.debit)}</td>
                      <td className={num}>{money(r.credit)}</td>
                      <td className={num}>{drCr(r.balance)}</td>
                    </tr>
                  );
                }
                // One row per invoice line (E01); the document amount and balance sit on the last line
                return r.items.map((it, j) => {
                  const last = j === r.items.length - 1;
                  return (
                    <tr key={`${i}-${j}`}>
                      <td className={cell}>{j === 0 ? formatDate(r.date, dateFormat) : ""}</td>
                      <td className={cell}>{j === 0 ? ref : ""}</td>
                      <td className={cell}>{it.description}</td>
                      <td className={num}>{money(it.unitPrice)}</td>
                      <td className={num}>{qty(it.quantity)}</td>
                      <td className={num}>{qty(it.loose)}</td>
                      <td className={num}>{last ? money(r.debit) : ""}</td>
                      <td className={num}>{last ? money(r.credit) : ""}</td>
                      <td className={num}>{last ? drCr(r.balance) : ""}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-black font-semibold">
                <td className="px-2 py-1" colSpan={6}>Total :</td>
                <td className="px-2 py-1 text-right tabular-nums">{money(statement.totalDebit)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{money(statement.totalCredit)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{drCr(statement.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
