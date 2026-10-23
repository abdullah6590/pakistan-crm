// src/app/dashboard/accounting/documents/[id]/page.tsx - Printable document (Report 14) with journal, stock and history.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { DOCUMENT_TYPES, STATUS_LABEL, REASON_LABEL, money, qty, drCr, formatDate, printDate } from "@/lib/accounting/meta";
import { getSetting } from "@/lib/accounting/setup";
import { amountInWords } from "@/lib/domain/words";
import { dec, div, sub, toFixed, fromPaisa, toPlain, isZero } from "@/lib/domain/decimal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DocumentActions from "./document-actions";

function words(total: string): string {
  const [rupees, paisa] = toFixed(dec(total), 2).replace("-", "").split(".");
  const text = `${amountInWords(Number(rupees))} Rupees`;
  return paisa && paisa !== "00" ? `${text} and ${amountInWords(Number(paisa))} Paisa Only` : `${text} Only`;
}

const cell = "border-b border-dotted border-gray-400 px-2 py-1";
const num = `${cell} text-right tabular-nums`;

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const doc = await prisma.accountingDocument.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: "asc" }, include: { component: { select: { sku: true, name: true, dimensionX: true, dimensionY: true, gsm: true } } } },
      partyAccount: true,
      cashAccount: true,
      journalEntries: { include: { lines: { include: { account: { select: { code: true, name: true } } } } }, orderBy: { createdAt: "asc" } },
      stockMovements: { include: { location: { select: { name: true } }, component: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      supersedes: { select: { id: true, docNo: true } },
      supersededBy: { select: { id: true, docNo: true } },
      relatedCharges: { include: { postings: { select: { id: true, docNo: true, status: true } } }, orderBy: { number: "asc" } },
      charge: { select: { id: true, chargeNo: true } },
    },
  });
  if (!doc) notFound();
  const resource = DOCUMENT_RESOURCE[doc.type];
  if (!can(user.role, resource, "read")) redirect("/dashboard/accounting");

  const meta = DOCUMENT_TYPES[doc.type];
  const [history, businessName, businessAddress, dateFormat, counter] = await Promise.all([
    prisma.auditLog.findMany({ where: { entity: "AccountingDocument", entityId: id }, orderBy: { createdAt: "asc" } }),
    getSetting(prisma, "BUSINESS_NAME"),
    getSetting(prisma, "BUSINESS_ADDRESS"),
    getSetting(prisma, "DATE_FORMAT"),
    doc.counterAccountId ? prisma.ledgerAccount.findUnique({ where: { id: doc.counterAccountId } }) : Promise.resolve(null),
  ]);
  const people = await prisma.user.findMany({
    where: { id: { in: [doc.createdById, doc.approvedById, doc.rejectedById, doc.cancelledById, ...history.map((h) => h.userId)].filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const who = (uid: string | null) => (uid ? people.find((p) => p.id === uid)?.name ?? "Unknown user" : "-");
  const when = (d: Date | null) => (d ? `${formatDate(d, dateFormat)} ${d.toTimeString().slice(0, 5)}` : "-");

  const itemDoc = meta.form === "items";
  const priced = !!meta.priced;
  const purchase = doc.type === "PURCHASE_INVOICE";
  const dp = purchase ? 2 : 0;
  const totalUnits = doc.lines.reduce((a, l) => a + dec(l.baseQuantity), BigInt(0));
  const totalCost = doc.lines.reduce((a, l) => a + (l.costAmount ? dec(l.costAmount) : BigInt(0)), BigInt(0));
  const debitSide = doc.journalEntries.find((e) => e.kind === "POSTING")?.lines.find((l) => l.debitPaisa > BigInt(0));
  const creditSide = doc.journalEntries.find((e) => e.kind === "POSTING")?.lines.find((l) => l.creditPaisa > BigInt(0));

  return (
    <div className="space-y-6">
      <DocumentActions
        id={doc.id}
        status={doc.status}
        printCount={doc.printCount}
        canApprove={can(user.role, "stockApproval", "write") && doc.status === "PENDING_APPROVAL" && !!meta.approval}
        isCreator={doc.createdById === user.id}
        canCancel={can(user.role, resource, "delete") && (doc.status === "POSTED" || doc.status === "PENDING_APPROVAL")}
        backHref={`/dashboard/accounting/documents?type=${doc.type}`}
      />

      {/* ─── Printable document ───────────────────────────────── */}
      <div className="rounded-lg border bg-white p-6 text-black print:border-0 print:p-0">
        <div className="flex items-start justify-between text-xs">
          <span>{printDate()}</span>
          {doc.printCount > 0 && <span>Reprint #{doc.printCount}</span>}
        </div>
        <div className="mt-2 text-center">
          <div className="text-xl font-bold">{businessName || "Business name (set in Books settings)"}</div>
          {businessAddress && <div className="text-sm">{businessAddress}</div>}
          <div className="mt-1 text-lg font-semibold uppercase tracking-wide">{doc.type === "VOUCHER" ? `${doc.series} voucher` : meta.title}</div>
          {doc.status !== "POSTED" && <div className="text-sm font-bold text-red-700">{STATUS_LABEL[doc.status]?.toUpperCase()}</div>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div><b>No:</b> {doc.docNo}</div>
          <div className="text-right"><b>Date:</b> {formatDate(doc.date, dateFormat)}</div>
          {doc.partyAccount && <div><b>{meta.party === "press" ? "Press" : purchase ? "Supplier" : doc.type === "VOUCHER" ? (doc.series.endsWith("RV") ? "Received from" : "Paid to") : "Customer"}:</b> {doc.partyAccount.code} {doc.partyAccount.name}{doc.partyAccount.phone ? ` ${doc.partyAccount.phone}` : ""}</div>}
          {doc.cashAccount && <div><b>{doc.type === "TRANSFER" ? "From" : "Cash/bank"}:</b> {doc.cashAccount.name}</div>}
          {counter && doc.type !== "VOUCHER" && <div><b>{doc.type === "TRANSFER" ? "To" : "Charged to"}:</b> {counter.name}</div>}
          {doc.reason && <div><b>Reason:</b> {REASON_LABEL[doc.reason] ?? doc.reason}</div>}
          {purchase && <div><b>Supplier bill:</b> {doc.vendorBillNo ?? "-"} {doc.vendorBillDate ? formatDate(doc.vendorBillDate, dateFormat) : ""}</div>}
          {purchase && <div><b>Bilty:</b> {doc.biltyNo ?? "-"} {doc.biltyDate ? formatDate(doc.biltyDate, dateFormat) : ""}</div>}
          <div><b>Prepared by:</b> {who(doc.createdById)}</div>
          {doc.approvedById && <div><b>Approved by:</b> {who(doc.approvedById)} {when(doc.approvedAt)}</div>}
        </div>

        {itemDoc && (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black">
                <th className="px-2 py-1 text-left">S.No</th>
                <th className="px-2 py-1 text-left">Item</th>
                {priced && <th className="px-2 py-1 text-right">Rate</th>}
                <th className="px-2 py-1 text-right">Catan</th>
                <th className="px-2 py-1 text-right">C in Q</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Total units</th>
                {doc.type === "PRESS_RECEIPT" && <th className="px-2 py-1 text-left">Material used</th>}
                {priced && <th className="px-2 py-1 text-right">Amount</th>}
                {!priced && <th className="px-2 py-1 text-right">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => {
                // Units per pack recovered from the stored line: (base units - loose) / packs; 1 means the base unit was entered
                const perPack = isZero(dec(l.quantity)) ? null : div(sub(dec(l.baseQuantity), dec(l.loose)), dec(l.quantity));
                const isBase = perPack === null ? isZero(dec(l.loose)) : perPack === dec(1) && isZero(dec(l.loose));
                const size = l.component?.dimensionX ? ` ${l.component.dimensionX}x${l.component.dimensionY}x${l.component.gsm}` : "";
                return (
                  <tr key={l.id}>
                    <td className={cell}>{l.lineNo}</td>
                    <td className={cell}>{l.description}{size}{l.stockWarning ? " *" : ""}</td>
                    {priced && <td className={num}>{money(l.unitPrice)}</td>}
                    <td className={num}>{isBase ? "-" : `${qty(l.quantity)} ${l.unit}`}</td>
                    <td className={num}>{isBase || perPack === null ? "-" : qty(toPlain(perPack))}</td>
                    <td className={num}>{isBase ? qty(l.quantity) : qty(l.loose)}</td>
                    <td className={num}>{qty(l.baseQuantity)}</td>
                    {doc.type === "PRESS_RECEIPT" && <td className={cell}>{l.consumedQuantity ? `${qty(l.consumedQuantity)} base units` : "-"}</td>}
                    {priced && <td className={num}>{money(l.amount)}</td>}
                    {!priced && <td className={num}>{l.costAmount ? money(l.costAmount) : l.costStatus === "UNAVAILABLE" ? "n/a" : "-"}{l.costStatus && l.costStatus !== "ACTUAL" ? ` (${l.costStatus.toLowerCase()})` : ""}</td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-black font-semibold">
                <td className="px-2 py-1" colSpan={priced ? 6 : 5}>Total</td>
                <td className="px-2 py-1 text-right tabular-nums">{qty(toPlain(totalUnits))}</td>
                {doc.type === "PRESS_RECEIPT" && <td />}
                <td className="px-2 py-1 text-right tabular-nums">{priced ? money(doc.exactTotal) : money(toPlain(totalCost))}</td>
              </tr>
            </tfoot>
          </table>
        )}

        {doc.type === "VOUCHER" && (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead><tr className="border-y border-black"><th className="px-2 py-1 text-left">Account</th><th className="px-2 py-1 text-right">Debit</th><th className="px-2 py-1 text-right">Credit</th></tr></thead>
            <tbody>
              {debitSide && <tr><td className={cell}>{debitSide.account.code} {debitSide.account.name}</td><td className={num}>{money(toPlain(fromPaisa(debitSide.debitPaisa)))}</td><td className={num}>-</td></tr>}
              {creditSide && <tr><td className={cell}>{creditSide.account.code} {creditSide.account.name}</td><td className={num}>-</td><td className={num}>{money(toPlain(fromPaisa(creditSide.creditPaisa)))}</td></tr>}
            </tbody>
          </table>
        )}

        <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div className="space-y-1">
            {doc.remarks && <div><b>Remarks:</b> {doc.remarks}</div>}
            {(priced || meta.form === "money" || doc.type === "PRESS_RECEIPT") && doc.total !== "0" && <div><b>Amount in words:</b> {words(doc.total)}</div>}
            {doc.lines.some((l) => l.stockWarning) && <div className="text-xs">* Stock for this item went below zero.</div>}
          </div>
          <div className="space-y-1">
            {priced && (<>
              <div className="flex justify-between"><span>Sub-total</span><span className="tabular-nums">{money(doc.exactTotal)}</span></div>
              {doc.roundingAdjustment !== "0" && <div className="flex justify-between"><span>Rounding</span><span className="tabular-nums">{money(doc.roundingAdjustment)}</span></div>}
              <div className="flex justify-between border-t border-black font-bold"><span>Total</span><span className="tabular-nums">{money(doc.total, dp)}</span></div>
              {doc.type === "CASH_SALE" && <div className="flex justify-between"><span>Received</span><span className="tabular-nums">{money(doc.amountReceived, 0)}</span></div>}
            </>)}
            {meta.form === "money" && <div className="flex justify-between font-bold"><span>Amount</span><span className="tabular-nums">{money(doc.total)}</span></div>}
            {doc.previousBalance !== null && (
              <div className="mt-2 border-t border-black pt-1">
                <div className="flex justify-between"><span>Previous balance</span><span className="tabular-nums">{drCr(doc.previousBalance, dp)}</span></div>
                <div className="flex justify-between"><span>This document</span><span className="tabular-nums">{drCr(toPlain(dec(doc.newBalance!) - dec(doc.previousBalance)), dp)}</span></div>
                <div className="flex justify-between font-bold"><span>New balance</span><span className="tabular-nums">{drCr(doc.newBalance, dp)}</span></div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 text-xs text-gray-600">Printed by {user.name} · {when(new Date())}</div>
      </div>

      {/* ─── Screen-only detail ───────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2 print:hidden">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Journal</CardTitle></CardHeader>
          <CardContent>
            {doc.journalEntries.length === 0 ? <p className="text-sm text-muted-foreground">No money moved by this document.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {doc.journalEntries.flatMap((e) => e.lines.map((l) => (
                    <TableRow key={l.id} className={e.kind === "REVERSAL" ? "text-muted-foreground" : ""}>
                      <TableCell>{e.kind === "REVERSAL" ? "↺ " : ""}{l.account.name}<span className="ml-1 text-xs text-muted-foreground">{l.memo}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{money(toPlain(fromPaisa(l.debitPaisa)))}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(toPlain(fromPaisa(l.creditPaisa)))}</TableCell>
                    </TableRow>
                  )))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Stock movements</CardTitle></CardHeader>
          <CardContent>
            {doc.stockMovements.length === 0 ? <p className="text-sm text-muted-foreground">{doc.status === "PENDING_APPROVAL" ? "Stock moves only after approval." : "No stock moved."}</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Where</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                <TableBody>
                  {doc.stockMovements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.component.name}{m.kind.endsWith("REVERSAL") ? " (reversal)" : ""}</TableCell>
                      <TableCell>{m.location.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{qty(m.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qty(m.balanceAfter)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.costAmount ? money(m.costAmount) : "n/a"}{m.costStatus && m.costStatus !== "ACTUAL" ? ` (${m.costStatus.toLowerCase()})` : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {(doc.relatedCharges.length > 0 || doc.charge) && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Charges</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {doc.charge && <div>This posting belongs to charge <Link className="text-primary hover:underline" href="/dashboard/accounting/charges">{doc.charge.chargeNo}</Link>; reverse it from the Charges screen.</div>}
              {doc.relatedCharges.map((c) => {
                const active = c.postings.find((p) => p.status === "POSTED");
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{c.chargeNo}</span>
                    <span>{c.description}</span>
                    <span className="tabular-nums">{money(c.amount)}</span>
                    {c.status === "POSTED" && active ? <Badge>Posted as expense · {active.docNo}</Badge>
                      : c.status === "CANCELLED" ? <Badge variant="outline">Cancelled</Badge>
                      : <Badge variant="secondary">Record only — not posted to accounts</Badge>}
                  </div>
                );
              })}
              <Link className="text-primary hover:underline" href="/dashboard/accounting/charges">Open the Charges screen</Link>
            </CardContent>
          </Card>
        )}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {doc.supersedes && <div>Replaces <Link className="text-primary hover:underline" href={`/dashboard/accounting/documents/${doc.supersedes.id}`}>{doc.supersedes.docNo}</Link></div>}
            {doc.supersededBy && <div>Replaced by <Link className="text-primary hover:underline" href={`/dashboard/accounting/documents/${doc.supersededBy.id}`}>{doc.supersededBy.docNo}</Link></div>}
            {doc.rejectionReason && <div>Rejected by {who(doc.rejectedById)} {when(doc.rejectedAt)}: {doc.rejectionReason}</div>}
            {doc.cancelReason && <div>Cancelled by {who(doc.cancelledById)} {when(doc.cancelledAt)}: {doc.cancelReason}</div>}
            {history.map((h) => (
              <div key={h.id} className="flex gap-2">
                <Badge variant="outline">{h.action}</Badge>
                <span>{who(h.userId)}</span>
                <span className="text-muted-foreground">{when(h.createdAt)}</span>
                {h.reason && <span>· {h.reason}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
