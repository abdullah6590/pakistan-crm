// src/lib/sales/statement.ts - A customer's statement from Books (Report 28 §5): every bill, receipt, refund and
// adjustment on the customer's account with a running balance (positive = the customer owes us). Cancelled documents
// are left out: their posting and reversal cancel each other on the same date.
import type { PrismaClient } from "@prisma/client";
import { dec, fromPaisa, toPlain, add, sub, ZERO } from "@/lib/domain/decimal";
import { invoicePayments } from "@/lib/accounting/receivables";

const KIND: Record<string, string> = {
  SALE_INVOICE: "Bill", CASH_SALE: "Cash sale", SALE_RETURN: "Return", OPENING_BALANCE: "Opening balance", VOUCHER: "Voucher",
};

function describe(type: string, series: string) {
  if (type === "VOUCHER") return series === "CRV" || series === "BRV" ? "Payment received" : series === "CPV" || series === "BPV" ? "Refund paid" : "Adjustment";
  return KIND[type] ?? type;
}

export async function customerStatement(db: PrismaClient, customerId: string, opts: { from?: string; to?: string } = {}) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true, address: true } });
  if (!customer) return null;
  const party = await db.ledgerAccount.findUnique({ where: { customerId } });
  const from = opts.from ? new Date(opts.from) : null;
  const to = opts.to ? new Date(`${opts.to}T23:59:59.999Z`) : null;
  const lines = party
    ? await db.journalLine.findMany({
        where: { accountId: party.id, entry: { document: { status: { not: "CANCELLED" } }, ...(to ? { date: { lte: to } } : {}) } },
        include: { entry: { include: { document: { select: { id: true, docNo: true, type: true, series: true, remarks: true, total: true } } } } },
        orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
      })
    : [];
  let opening = ZERO;
  let balance = ZERO;
  const rows: { date: string; docId: string; docNo: string; kind: string; remarks: string | null; debit: string; credit: string; balance: string; remaining?: string }[] = [];
  for (const l of lines) {
    const amt = sub(fromPaisa(l.debitPaisa), fromPaisa(l.creditPaisa));
    if (from && l.entry.date < from) {
      opening = add(opening, amt);
      balance = opening;
      continue;
    }
    balance = add(balance, amt);
    const d = l.entry.document!;
    rows.push({
      date: l.entry.date.toISOString(), docId: d.id, docNo: d.docNo, kind: describe(d.type, d.series), remarks: d.remarks,
      debit: toPlain(fromPaisa(l.debitPaisa)), credit: toPlain(fromPaisa(l.creditPaisa)), balance: toPlain(balance),
    });
  }
  // What each bill on the statement still owes
  for (const r of rows.filter((x) => x.kind === "Bill")) {
    r.remaining = (await invoicePayments(db, r.docId)).remaining;
  }
  const totals = rows.reduce((t, r) => ({ debit: add(t.debit, dec(r.debit)), credit: add(t.credit, dec(r.credit)) }), { debit: ZERO, credit: ZERO });
  return {
    customer,
    partyAccountId: party?.id ?? null,
    from: opts.from ?? null,
    to: opts.to ?? null,
    opening: toPlain(opening),
    rows,
    totalDebit: toPlain(totals.debit),
    totalCredit: toPlain(totals.credit),
    closing: toPlain(balance),
  };
}
