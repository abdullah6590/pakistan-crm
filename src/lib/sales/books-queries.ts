// src/lib/sales/books-queries.ts - What the Sales screens show from Books (Report 28): the bill list with what each
// bill has received and still owes, and one bill with its payments, revisions and history.
import type { Prisma, PrismaClient } from "@prisma/client";
import { dec, sub, cmp, ZERO, add, toPlain } from "@/lib/domain/decimal";
import { getSetting } from "@/lib/accounting/setup";
import { amountInWords } from "@/lib/domain/words";
import { invoicePayments, paymentStatus, unappliedReceipts, openInvoices, PaymentStatus } from "@/lib/accounting/receivables";
import { accountBalance } from "@/lib/accounting/posting";
import { UNIT_FIELDS } from "./units";

export const BILL_TYPES = ["SALE_INVOICE", "CASH_SALE"];

export interface BillFilters {
  search?: string;
  customerId?: string;
  status?: string; // UNPAID | PARTIALLY_PAID | PAID | CANCELLED
  from?: string;
  to?: string;
  page?: number;
}

/** Name of a walk-in customer, kept in a cash sale's remarks as "Customer: <name>". */
export function walkInName(remarks: string | null | undefined) {
  const m = /Customer: ([^|]+)/.exec(remarks ?? "");
  return m ? m[1].trim() : null;
}
/** Remarks without the walk-in customer's name. */
export function billNotes(remarks: string | null | undefined) {
  return (remarks ?? "").split(" | ").filter((p) => !p.startsWith("Customer: ")).join(" | ") || null;
}

export function rupeesInWords(total: string) {
  const n = Number(total);
  const rupees = Math.floor(Math.abs(n));
  const paisa = Math.round((Math.abs(n) - rupees) * 100);
  return paisa ? `${amountInWords(rupees)} Rupees and ${amountInWords(paisa)} Paisa Only` : `${amountInWords(rupees)} Rupees Only`;
}

/** Bills for the Sales list: current versions only (an amended bill shows its latest revision). */
export async function listBills(db: PrismaClient, f: BillFilters, pageSize = 50) {
  const party = f.customerId ? await db.ledgerAccount.findUnique({ where: { customerId: f.customerId } }) : null;
  const where: Prisma.AccountingDocumentWhereInput = {
    type: { in: BILL_TYPES },
    supersededBy: { is: null },
    ...(f.status === "CANCELLED" ? { status: "CANCELLED" } : { status: "POSTED" }),
    ...(f.customerId ? { partyAccountId: party?.id ?? "none" } : {}),
    ...(f.from || f.to ? { date: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999Z`) } : {}) } } : {}),
    ...(f.search ? { OR: [{ docNo: { contains: f.search } }, { remarks: { contains: f.search } }, { partyAccount: { name: { contains: f.search } } }, { lines: { some: { description: { contains: f.search } } } }] } : {}),
  };
  const docs = await db.accountingDocument.findMany({
    where,
    include: { partyAccount: { select: { name: true, phone: true, customerId: true } }, cashAccount: { select: { name: true } }, lines: { select: { description: true, baseQuantity: true, amount: true, costAmount: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const paidBy = new Map<string, bigint>();
  for (const a of await db.paymentAllocation.findMany({ where: { releasedAt: null, debitDocId: { in: docs.map((d) => d.id) } }, select: { debitDocId: true, amount: true } })) {
    paidBy.set(a.debitDocId, add(paidBy.get(a.debitDocId) ?? ZERO, dec(a.amount)));
  }
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let rows = docs.map((d) => {
    const total = dec(d.total);
    const paid = d.type === "CASH_SALE" ? dec(d.amountReceived ?? d.total) : paidBy.get(d.id) ?? ZERO;
    const remaining = cmp(paid, total) >= 0 ? ZERO : sub(total, paid);
    const cost = d.lines.reduce((t, l) => (l.costAmount === null ? t : add(t, dec(l.costAmount))), ZERO);
    return {
      id: d.id, docNo: d.docNo, type: d.type, revision: d.revision, date: d.date.toISOString(), status: d.status,
      customer: d.type === "SALE_INVOICE" ? d.partyAccount?.name ?? "" : walkInName(d.remarks) ?? "Walk-in",
      walkIn: d.type === "CASH_SALE", items: d.lines.map((l) => l.description).join(", "),
      total: toPlain(total), paid: toPlain(paid), remaining: toPlain(remaining),
      paymentStatus: (d.status === "POSTED" ? paymentStatus(total, paid) : "CANCELLED") as PaymentStatus | "CANCELLED",
      profit: toPlain(sub(total, cost)), madeBy: users.get(d.createdById) ?? "",
    };
  });
  if (f.status && f.status !== "CANCELLED") rows = rows.filter((r) => r.paymentStatus === f.status);
  const page = Math.max(1, f.page ?? 1);
  const totals = rows.reduce((t, r) => ({ total: add(t.total, dec(r.total)), remaining: add(t.remaining, dec(r.remaining)), profit: add(t.profit, dec(r.profit)) }), { total: ZERO, remaining: ZERO, profit: ZERO });
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)), totalRecords: rows.length },
    stats: { count: rows.length, total: toPlain(totals.total), outstanding: toPlain(totals.remaining), profit: toPlain(totals.profit) },
  };
}

/** One bill as shown, printed and saved as PDF: its current version, payments, revisions and history. */
export async function loadBooksBill(db: PrismaClient, id: string) {
  const doc = await db.accountingDocument.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: "asc" }, include: { component: { select: { id: true, sku: true, name: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true, ...UNIT_FIELDS } } } },
      partyAccount: true, cashAccount: true,
      supersedes: { select: { id: true, docNo: true } }, supersededBy: { select: { id: true, docNo: true } },
    },
  });
  if (!doc || !BILL_TYPES.includes(doc.type)) return null;
  // The whole chain of versions, oldest first
  const versions: { id: string; docNo: string; total: string; status: string; date: Date }[] = [];
  let cur: { id: string } | null = doc;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const v: { id: string; docNo: string; total: string; status: string; date: Date; supersedesId: string | null } | null = await db.accountingDocument.findUnique({ where: { id: cur.id }, select: { id: true, docNo: true, total: true, status: true, date: true, supersedesId: true } });
    if (!v) break;
    versions.unshift(v);
    cur = v.supersedesId ? { id: v.supersedesId } : null;
  }
  const payments = doc.type === "SALE_INVOICE" ? await invoicePayments(db, doc.id) : null;
  const history = await db.auditLog.findMany({ where: { entity: "AccountingDocument", entityId: { in: versions.map((v) => v.id) } }, orderBy: { createdAt: "asc" } });
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set([doc.createdById, ...history.map((h) => h.userId)])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const [businessName, businessAddress] = await Promise.all([getSetting(db, "BUSINESS_NAME"), getSetting(db, "BUSINESS_ADDRESS")]);
  const total = dec(doc.total);
  const paid = doc.type === "CASH_SALE" ? dec(doc.amountReceived ?? doc.total) : dec(payments!.paid);
  const remaining = cmp(paid, total) >= 0 ? ZERO : sub(total, paid);
  return {
    doc,
    customerName: doc.type === "SALE_INVOICE" ? doc.partyAccount?.name ?? "" : walkInName(doc.remarks) ?? "Walk-in",
    customerPhone: doc.type === "SALE_INVOICE" ? doc.partyAccount?.phone ?? null : null,
    customerId: doc.partyAccount?.customerId ?? null,
    notes: billNotes(doc.remarks),
    total: toPlain(total), paid: toPlain(paid), remaining: toPlain(remaining),
    status: doc.status === "POSTED" ? paymentStatus(total, paid) : ("CANCELLED" as const),
    payments: payments?.payments ?? (doc.type === "CASH_SALE" ? [{ allocationId: "", receiptId: doc.id, receiptNo: doc.docNo, date: doc.date, method: doc.cashAccount?.name ?? "Cash", amount: toPlain(paid), source: "CASH_SALE" }] : []),
    versions: versions.map((v) => ({ ...v, current: v.id === doc.id })),
    history: history.map((h) => ({ id: h.id, at: h.createdAt, action: h.action, by: people.get(h.userId) ?? "Unknown user", reason: h.reason, documentId: h.entityId })),
    madeBy: people.get(doc.createdById) ?? "",
    words: rupeesInWords(toPlain(total)),
    businessName: businessName || "Paper Mill ERP",
    businessAddress: businessAddress || "",
  };
}

/** A customer's account for the Receive payment screen: what they owe per bill, their credit, and their balance. */
export async function customerAccount(db: PrismaClient, customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true } });
  if (!customer) return null;
  const party = await db.ledgerAccount.findUnique({ where: { customerId } });
  if (!party) return { customer, partyAccountId: null, balance: "0", invoices: [], credit: [] };
  const [balance, invoices, credit] = await Promise.all([accountBalance(db, party.id), openInvoices(db, party.id), unappliedReceipts(db, party.id)]);
  return {
    customer, partyAccountId: party.id, balance: toPlain(balance),
    invoices: invoices.map((i) => ({ id: i.invoice.id, docNo: i.invoice.docNo, date: i.invoice.date, total: i.invoice.total, paid: toPlain(i.paid), remaining: toPlain(i.remaining) })),
    credit: credit.map((c) => ({ receiptId: c.receipt.id, receiptNo: c.receipt.docNo, date: c.receipt.date, total: c.receipt.total, unapplied: toPlain(c.unapplied) })),
  };
}

/** Outstanding receivables (Report 28 §2): every unpaid or part-paid bill by customer, with its age and any credit. */
export async function receivablesReport(db: PrismaClient, asOf = new Date()) {
  const invoices = await db.accountingDocument.findMany({
    where: { type: "SALE_INVOICE", status: "POSTED" },
    include: { partyAccount: { select: { id: true, name: true, phone: true, customerId: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const paidBy = new Map<string, bigint>();
  for (const a of await db.paymentAllocation.findMany({ where: { releasedAt: null, debitDocId: { in: invoices.map((i) => i.id) } }, select: { debitDocId: true, amount: true } })) {
    paidBy.set(a.debitDocId, add(paidBy.get(a.debitDocId) ?? ZERO, dec(a.amount)));
  }
  const day = 86_400_000;
  const buckets = ["0-30", "31-60", "61-90", "90+"] as const;
  const bucketOf = (days: number) => (days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");
  const byCustomer = new Map<string, { partyAccountId: string; customerId: string | null; name: string; phone: string | null; outstanding: bigint; ages: Record<string, bigint>; invoices: { id: string; docNo: string; date: string; total: string; paid: string; remaining: string; days: number }[] }>();
  for (const inv of invoices) {
    const paid = paidBy.get(inv.id) ?? ZERO;
    const remaining = sub(dec(inv.total), paid);
    if (cmp(remaining, ZERO) <= 0 || !inv.partyAccount) continue;
    const days = Math.max(0, Math.floor((asOf.getTime() - inv.date.getTime()) / day));
    const c = byCustomer.get(inv.partyAccount.id) ?? {
      partyAccountId: inv.partyAccount.id, customerId: inv.partyAccount.customerId, name: inv.partyAccount.name, phone: inv.partyAccount.phone,
      outstanding: ZERO, ages: Object.fromEntries(buckets.map((b) => [b, ZERO])) as Record<string, bigint>, invoices: [],
    };
    c.outstanding = add(c.outstanding, remaining);
    c.ages[bucketOf(days)] = add(c.ages[bucketOf(days)], remaining);
    c.invoices.push({ id: inv.id, docNo: inv.docNo, date: inv.date.toISOString(), total: inv.total, paid: toPlain(paid), remaining: toPlain(remaining), days });
    byCustomer.set(inv.partyAccount.id, c);
  }
  type Row = { partyAccountId: string; customerId: string | null; name: string; phone: string | null; outstanding: string; credit: string; ages: Record<string, string>; invoices: { id: string; docNo: string; date: string; total: string; paid: string; remaining: string; days: number }[] };
  const customers: Row[] = [];
  for (const c of [...byCustomer.values()].sort((a, b) => cmp(b.outstanding, a.outstanding))) {
    const credit = (await unappliedReceipts(db, c.partyAccountId)).reduce((t, r) => add(t, r.unapplied), ZERO);
    customers.push({ ...c, outstanding: toPlain(c.outstanding), credit: toPlain(credit), ages: Object.fromEntries(Object.entries(c.ages).map(([k, v]) => [k, toPlain(v)])) });
  }
  const total = customers.reduce((t, c) => add(t, dec(c.outstanding)), ZERO);
  const ageTotals = Object.fromEntries(buckets.map((b) => [b, toPlain(customers.reduce((t, c) => add(t, dec(c.ages[b])), ZERO))]));
  return { asOf: asOf.toISOString(), customers, total: toPlain(total), ageTotals, buckets: [...buckets] };
}

/** Sales totals from Books bills since a date (current versions, not cancelled): for the dashboard (Report 28 §6). */
export async function booksSalesSince(db: PrismaClient, since: Date, until?: Date) {
  const docs = await db.accountingDocument.findMany({
    where: { type: { in: BILL_TYPES }, status: "POSTED", date: { gte: since, ...(until ? { lt: until } : {}) } },
    select: { total: true, lines: { select: { costAmount: true } } },
  });
  let total = ZERO;
  let cost = ZERO;
  for (const d of docs) {
    total = add(total, dec(d.total));
    for (const l of d.lines) if (l.costAmount !== null) cost = add(cost, dec(l.costAmount));
  }
  return { total: Number(toPlain(total)), profit: Number(toPlain(sub(total, cost))), count: docs.length };
}

/** The latest Books bills in the shape of the dashboard's "recent sales" list. */
export async function recentBooksBills(db: PrismaClient, take = 5) {
  const docs = await db.accountingDocument.findMany({
    where: { type: { in: BILL_TYPES }, status: "POSTED" },
    include: { partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
  const paidBy = new Map<string, bigint>();
  for (const a of await db.paymentAllocation.findMany({ where: { releasedAt: null, debitDocId: { in: docs.map((d) => d.id) } }, select: { debitDocId: true, amount: true } })) {
    paidBy.set(a.debitDocId, add(paidBy.get(a.debitDocId) ?? ZERO, dec(a.amount)));
  }
  return docs.map((d) => {
    const total = dec(d.total);
    const paid = d.type === "CASH_SALE" ? dec(d.amountReceived ?? d.total) : paidBy.get(d.id) ?? ZERO;
    const st = paymentStatus(total, paid);
    return {
      id: d.id, invoiceNumber: d.docNo, total: Number(d.total), paymentMethod: d.cashAccount?.name ?? "Credit",
      paymentStatus: st === "PAID" ? "PAID" : st === "PARTIALLY_PAID" ? "PARTIAL" : "PENDING",
      createdAt: d.createdAt, date: d.date, customer: d.type === "SALE_INVOICE" ? { name: d.partyAccount?.name ?? "" } : null,
      walkInName: d.type === "CASH_SALE" ? walkInName(d.remarks) : null,
    };
  });
}

/** Books bills, receipts and refunds in the Daybook's customer format (Report 28 §6). */
export async function booksCustomerDaybook(db: PrismaClient, f: { customerId?: string | null; from?: Date; to?: Date }) {
  const party = f.customerId ? await db.ledgerAccount.findUnique({ where: { customerId: f.customerId } }) : null;
  if (f.customerId && !party) return [];
  const docs = await db.accountingDocument.findMany({
    where: {
      status: "POSTED",
      OR: [{ type: { in: BILL_TYPES } }, { type: "VOUCHER", series: { in: ["CRV", "BRV", "CPV", "BPV"] }, partyAccount: { subType: "CUSTOMER" } }],
      ...(party ? { partyAccountId: party.id } : {}),
      ...(f.from || f.to ? { date: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    },
    include: { partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: 200,
  });
  const out: { id: string; date: Date; type: "SALE" | "RECEIPT" | "REFUND"; description: string; debit: number; credit: number; reference: string | null; entityName: string }[] = [];
  for (const d of docs) {
    const name = d.partyAccount?.name ?? walkInName(d.remarks) ?? "Walk-in";
    if (d.type === "SALE_INVOICE" || d.type === "CASH_SALE") {
      out.push({ id: d.id, date: d.date, type: "SALE", description: `Bill ${d.docNo}`, debit: Number(d.total), credit: 0, reference: d.docNo, entityName: name });
      if (d.type === "CASH_SALE" && Number(d.amountReceived ?? d.total) > 0) {
        out.push({ id: `${d.id}-paid`, date: d.date, type: "RECEIPT", description: `Paid with ${d.docNo} - ${d.cashAccount?.name ?? "Cash"}`, debit: 0, credit: Number(d.amountReceived ?? d.total), reference: d.docNo, entityName: name });
      }
    } else if (d.series === "CRV" || d.series === "BRV") {
      out.push({ id: d.id, date: d.date, type: "RECEIPT", description: `Payment received - ${d.cashAccount?.name ?? ""}`, debit: 0, credit: Number(d.total), reference: d.docNo, entityName: name });
    } else {
      out.push({ id: d.id, date: d.date, type: "REFUND", description: `Refund paid - ${d.cashAccount?.name ?? ""}`, debit: Number(d.total), credit: 0, reference: d.docNo, entityName: name });
    }
  }
  return out;
}
