// src/lib/purchases/queries.ts - What the Purchases and Suppliers screens show from Books (Report 30): purchase bills
// with what was paid and is still payable, one bill with its payments, returns, revisions, charges and documents, a
// supplier's account, the payables report and the supplier statement. Everything is worked out from postings and
// allocations; nothing is a stored running total.
import type { Prisma, PrismaClient } from "@prisma/client";
import { dec, sub, cmp, ZERO, add, toPlain, fromPaisa } from "@/lib/domain/decimal";
import { getSetting } from "@/lib/accounting/setup";
import { accountBalance } from "@/lib/accounting/posting";
import { billPayments, openBills, supplierCredit, BillStatus, PAYMENT_SERIES, SUPPLIER_REFUND_SERIES } from "@/lib/accounting/payables";
import { paymentStatus } from "@/lib/accounting/receivables";
import { rupeesInWords } from "@/lib/sales/books-queries";
import { UNIT_FIELDS } from "@/lib/sales/units";

export interface PurchaseFilters {
  search?: string;
  supplierId?: string;
  status?: string; // UNPAID | PARTIALLY_PAID | PAID | CANCELLED | OVERDUE
  from?: string;
  to?: string;
  page?: number;
}

const dayRange = (from?: string, to?: string) =>
  from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {};

async function settledMap(db: PrismaClient, ids: string[]) {
  const m = new Map<string, bigint>();
  for (const a of await db.paymentAllocation.findMany({ where: { releasedAt: null, debitDocId: { in: ids } }, select: { debitDocId: true, amount: true } })) {
    m.set(a.debitDocId, add(m.get(a.debitDocId) ?? ZERO, dec(a.amount)));
  }
  return m;
}

/** Purchase bills for the Purchases list: current versions only. */
export async function listPurchaseBills(db: PrismaClient, f: PurchaseFilters, pageSize = 50) {
  const party = f.supplierId ? await db.ledgerAccount.findUnique({ where: { supplierId: f.supplierId } }) : null;
  const where: Prisma.AccountingDocumentWhereInput = {
    type: "PURCHASE_INVOICE",
    supersededBy: { is: null },
    ...(f.status === "CANCELLED" ? { status: "CANCELLED" } : { status: "POSTED" }),
    ...(f.supplierId ? { partyAccountId: party?.id ?? "none" } : {}),
    ...dayRange(f.from, f.to),
    ...(f.search ? { OR: [{ docNo: { contains: f.search } }, { vendorBillNo: { contains: f.search } }, { remarks: { contains: f.search } }, { partyAccount: { name: { contains: f.search } } }, { lines: { some: { description: { contains: f.search } } } }] } : {}),
  };
  const docs = await db.accountingDocument.findMany({
    where,
    include: { partyAccount: { select: { name: true, supplierId: true, code: true } }, lines: { select: { description: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const settled = await settledMap(db, docs.map((d) => d.id));
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const now = Date.now();
  let rows = docs.map((d) => {
    const total = dec(d.total);
    const paid = settled.get(d.id) ?? ZERO;
    const remaining = cmp(paid, total) >= 0 ? ZERO : sub(total, paid);
    const status = (d.status === "POSTED" ? paymentStatus(total, paid) : "CANCELLED") as BillStatus;
    return {
      id: d.id, docNo: d.docNo, revision: d.revision, date: d.date.toISOString(), status: d.status,
      supplier: d.partyAccount?.name ?? "", supplierId: d.partyAccount?.supplierId ?? null, supplierCode: d.partyAccount?.code ?? "",
      vendorBillNo: d.vendorBillNo, dueDate: d.dueDate?.toISOString() ?? null,
      overdue: d.status === "POSTED" && !!d.dueDate && d.dueDate.getTime() < now && cmp(remaining, ZERO) > 0,
      items: d.lines.map((l) => l.description).join(", "),
      total: toPlain(total), paid: toPlain(paid), remaining: toPlain(remaining), paymentStatus: status, madeBy: users.get(d.createdById) ?? "",
    };
  });
  if (f.status === "OVERDUE") rows = rows.filter((r) => r.overdue);
  else if (f.status && f.status !== "CANCELLED") rows = rows.filter((r) => r.paymentStatus === f.status);
  const page = Math.max(1, f.page ?? 1);
  const totals = rows.reduce((t, r) => ({ total: add(t.total, dec(r.total)), remaining: add(t.remaining, dec(r.remaining)) }), { total: ZERO, remaining: ZERO });
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)), totalRecords: rows.length },
    stats: { count: rows.length, total: toPlain(totals.total), payable: toPlain(totals.remaining), overdue: rows.filter((r) => r.overdue).length },
  };
}

async function versionChain(db: PrismaClient, id: string) {
  const versions: { id: string; docNo: string; total: string; status: string; date: Date }[] = [];
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const v: { id: string; docNo: string; total: string; status: string; date: Date; supersedesId: string | null } | null = await db.accountingDocument.findUnique({ where: { id: cur }, select: { id: true, docNo: true, total: true, status: true, date: true, supersedesId: true } });
    if (!v) break;
    versions.unshift(v);
    cur = v.supersedesId;
  }
  return versions;
}

/** One purchase bill as shown, printed and saved as PDF. */
export async function loadPurchaseBill(db: PrismaClient, id: string) {
  const doc = await db.accountingDocument.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: "asc" }, include: { component: { select: { id: true, sku: true, name: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true, ...UNIT_FIELDS } } } },
      partyAccount: true,
      supersedes: { select: { id: true, docNo: true } }, supersededBy: { select: { id: true, docNo: true } },
      returns: { select: { id: true, docNo: true, date: true, total: true, status: true } },
      attachments: { where: { removedAt: null }, select: { id: true, fileName: true, mimeType: true, size: true, note: true, createdAt: true, uploadedById: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!doc || doc.type !== "PURCHASE_INVOICE") return null;
  const versions = await versionChain(db, doc.id);
  const ids = versions.map((v) => v.id);
  const [payments, history, charges] = await Promise.all([
    billPayments(db, doc.id),
    db.auditLog.findMany({ where: { entity: "AccountingDocument", entityId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    db.chargeRecord.findMany({ where: { documentId: { in: ids } }, orderBy: { createdAt: "asc" } }),
  ]);
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set([doc.createdById, ...history.map((h) => h.userId), ...doc.attachments.map((a) => a.uploadedById)])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const [businessName, businessAddress] = await Promise.all([getSetting(db, "BUSINESS_NAME"), getSetting(db, "BUSINESS_ADDRESS")]);
  const supplier = doc.partyAccount?.supplierId ? await db.supplier.findUnique({ where: { id: doc.partyAccount.supplierId }, select: { id: true, name: true, phone: true, address: true, contactPerson: true, taxNumber: true } }) : null;
  return {
    doc,
    supplier,
    supplierName: supplier?.name ?? doc.partyAccount?.name ?? "",
    supplierCode: doc.partyAccount?.code ?? "",
    ...payments,
    overdue: doc.status === "POSTED" && !!doc.dueDate && doc.dueDate.getTime() < Date.now() && cmp(dec(payments.remaining), ZERO) > 0,
    charges: charges.map((c) => ({ id: c.id, kind: c.kind, amount: c.amount, description: c.description, status: c.status })),
    versions: versions.map((v) => ({ ...v, current: v.id === doc.id })),
    history: history.map((h) => ({ id: h.id, at: h.createdAt, action: h.action, by: people.get(h.userId) ?? "Unknown user", reason: h.reason, documentId: h.entityId })),
    attachments: doc.attachments.map((a) => ({ ...a, by: people.get(a.uploadedById) ?? "" })),
    madeBy: people.get(doc.createdById) ?? "",
    words: rupeesInWords(doc.total),
    businessName: businessName || "Paper Mill ERP",
    businessAddress: businessAddress || "",
  };
}

/** A supplier's account for the Pay supplier screen and profile: open bills, credit and balance (positive = owed to them). */
export async function supplierAccount(db: PrismaClient, supplierId: string) {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return null;
  const party = await db.ledgerAccount.findUnique({ where: { supplierId } });
  if (!party) return { supplier, partyAccountId: null, partyCode: null, balance: "0", payable: "0", bills: [], credit: [] };
  const [balance, bills, credit] = await Promise.all([accountBalance(db, party.id), openBills(db, party.id), supplierCredit(db, party.id)]);
  return {
    supplier, partyAccountId: party.id, partyCode: party.code,
    // Books keeps a supplier's balance as a credit; screens show what is owed to them as a positive number
    balance: toPlain(sub(ZERO, balance)),
    payable: toPlain(bills.reduce((t, b) => add(t, b.remaining), ZERO)),
    bills: bills.map((b) => ({
      id: b.bill.id, docNo: b.bill.docNo, type: b.bill.type, vendorBillNo: b.bill.vendorBillNo, date: b.bill.date, dueDate: b.bill.dueDate,
      total: b.bill.total, paid: toPlain(b.paid), remaining: toPlain(b.remaining),
    })),
    credit: credit.map((c) => ({ sourceId: c.source.id, docNo: c.source.docNo, kind: c.source.type === "PURCHASE_RETURN" ? "Return" : c.source.type === "OPENING_BALANCE" ? "Opening advance" : "Payment", date: c.source.date, total: c.source.total, unapplied: toPlain(c.unapplied) })),
  };
}

/** Suppliers for the Suppliers list with their balance and payable, worked out from Books. */
export async function supplierList(db: PrismaClient, f: { search?: string; status?: "active" | "archived" | "all"; withBalance?: boolean }) {
  const q = f.search?.trim();
  const suppliers = await db.supplier.findMany({
    where: {
      ...(f.status === "archived" ? { isActive: false } : f.status === "all" ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q } }, { company: { contains: q } }, { contactPerson: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }, { city: { contains: q } }] } : {}),
    },
    orderBy: { name: "asc" },
  });
  const parties = new Map((await db.ledgerAccount.findMany({ where: { supplierId: { in: suppliers.map((s) => s.id) } } })).map((p) => [p.supplierId!, p]));
  const rows = [];
  for (const s of suppliers) {
    const party = parties.get(s.id);
    const balance = party ? sub(ZERO, await accountBalance(db, party.id)) : ZERO;
    const bills = party ? await db.accountingDocument.count({ where: { type: "PURCHASE_INVOICE", status: "POSTED", partyAccountId: party.id } }) : 0;
    rows.push({ ...s, partyCode: party?.code ?? null, balance: toPlain(balance), bills });
  }
  if (f.withBalance) return rows.filter((r) => Number(r.balance) !== 0);
  return rows;
}

/** Outstanding payables (Report 30 §7): every unpaid or part-paid bill by supplier, with its age, due date and credit. */
export async function payablesReport(db: PrismaClient, asOf = new Date()) {
  const bills = await db.accountingDocument.findMany({
    where: { status: "POSTED", type: { in: ["PURCHASE_INVOICE", "OPENING_BALANCE"] }, partyAccount: { subType: "SUPPLIER" } },
    include: { partyAccount: { select: { id: true, name: true, phone: true, supplierId: true, code: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const day = 86_400_000;
  const buckets = ["0-30", "31-60", "61-90", "90+"] as const;
  const bucketOf = (days: number) => (days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+");
  type Bill = { id: string; docNo: string; vendorBillNo: string | null; date: string; dueDate: string | null; overdue: boolean; total: string; paid: string; remaining: string; days: number };
  const bySupplier = new Map<string, { partyAccountId: string; supplierId: string | null; code: string; name: string; phone: string | null; outstanding: bigint; overdue: bigint; ages: Record<string, bigint>; bills: Bill[] }>();
  for (const b of bills) {
    if (!b.partyAccount) continue;
    const open = (await openBills(db, b.partyAccount.id)).find((o) => o.bill.id === b.id);
    if (!open) continue;
    const days = Math.max(0, Math.floor((asOf.getTime() - b.date.getTime()) / day));
    const overdue = !!b.dueDate && b.dueDate.getTime() < asOf.getTime();
    const s = bySupplier.get(b.partyAccount.id) ?? {
      partyAccountId: b.partyAccount.id, supplierId: b.partyAccount.supplierId, code: b.partyAccount.code, name: b.partyAccount.name, phone: b.partyAccount.phone,
      outstanding: ZERO, overdue: ZERO, ages: Object.fromEntries(buckets.map((k) => [k, ZERO])) as Record<string, bigint>, bills: [],
    };
    s.outstanding = add(s.outstanding, open.remaining);
    if (overdue) s.overdue = add(s.overdue, open.remaining);
    s.ages[bucketOf(days)] = add(s.ages[bucketOf(days)], open.remaining);
    s.bills.push({ id: b.id, docNo: b.docNo, vendorBillNo: b.vendorBillNo, date: b.date.toISOString(), dueDate: b.dueDate?.toISOString() ?? null, overdue, total: b.total, paid: toPlain(open.paid), remaining: toPlain(open.remaining), days });
    bySupplier.set(b.partyAccount.id, s);
  }
  const suppliers: (Omit<ReturnType<typeof bySupplier.get> & object, "outstanding" | "overdue" | "ages"> & { outstanding: string; overdue: string; credit: string; ages: Record<string, string> })[] = [];
  for (const s of [...bySupplier.values()].sort((a, b) => cmp(b.outstanding, a.outstanding))) {
    const credit = (await supplierCredit(db, s.partyAccountId)).reduce((t, c) => add(t, c.unapplied), ZERO);
    suppliers.push({ ...s, outstanding: toPlain(s.outstanding), overdue: toPlain(s.overdue), credit: toPlain(credit), ages: Object.fromEntries(Object.entries(s.ages).map(([k, v]) => [k, toPlain(v)])) });
  }
  const total = suppliers.reduce((t, s) => add(t, dec(s.outstanding)), ZERO);
  const ageTotals = Object.fromEntries(buckets.map((k) => [k, toPlain(suppliers.reduce((t, s) => add(t, dec(s.ages[k])), ZERO))]));
  return { asOf: asOf.toISOString(), suppliers, total: toPlain(total), overdue: toPlain(suppliers.reduce((t, s) => add(t, dec(s.overdue)), ZERO)), ageTotals, buckets: [...buckets] };
}

/** A supplier's payments (and refunds they made), newest first, with the bills each one settled. */
export async function supplierPayments(db: PrismaClient, f: { supplierId?: string; from?: string; to?: string; includeCancelled?: boolean }) {
  const party = f.supplierId ? await db.ledgerAccount.findUnique({ where: { supplierId: f.supplierId } }) : null;
  if (f.supplierId && !party) return [];
  const docs = await db.accountingDocument.findMany({
    where: {
      type: "VOUCHER", series: { in: [...PAYMENT_SERIES, ...SUPPLIER_REFUND_SERIES] }, partyAccount: { subType: "SUPPLIER" },
      ...(party ? { partyAccountId: party.id } : {}),
      ...(f.includeCancelled ? {} : { status: "POSTED" }),
      ...dayRange(f.from, f.to),
    },
    include: {
      partyAccount: { select: { name: true, supplierId: true } }, cashAccount: { select: { name: true } },
      allocationsGiven: { where: { releasedAt: null }, include: { debitDoc: { select: { id: true, docNo: true, vendorBillNo: true } } } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return docs.map((d) => {
    const used = d.allocationsGiven.reduce((t, a) => add(t, dec(a.amount)), ZERO);
    const refund = (SUPPLIER_REFUND_SERIES as readonly string[]).includes(d.series);
    return {
      id: d.id, docNo: d.docNo, date: d.date.toISOString(), status: d.status, kind: refund ? "REFUND_RECEIVED" : "PAYMENT",
      supplier: d.partyAccount?.name ?? "", supplierId: d.partyAccount?.supplierId ?? null, account: d.cashAccount?.name ?? "",
      reference: d.vendorBillNo, remarks: d.remarks, amount: d.total, unapplied: refund ? "0" : toPlain(sub(dec(d.total), used)),
      bills: d.allocationsGiven.map((a) => ({ id: a.debitDoc.id, docNo: a.debitDoc.docNo, vendorBillNo: a.debitDoc.vendorBillNo, amount: a.amount, source: a.source })),
    };
  });
}

const KIND: Record<string, string> = {
  PURCHASE_INVOICE: "Purchase bill", PURCHASE_RETURN: "Goods returned", OPENING_BALANCE: "Opening balance", CHARGE_EXPENSE: "Charge", VOUCHER: "Voucher",
};

function describe(type: string, series: string) {
  if (type === "VOUCHER") return series === "CPV" || series === "BPV" ? "Payment" : series === "CRV" || series === "BRV" ? "Refund received" : "Adjustment";
  return KIND[type] ?? type;
}

/**
 * A supplier's statement: opening balance, every bill, payment, return, refund received and adjustment with a running balance
 * (positive = the business owes the supplier), and the closing balance. Cancelled documents are left out: their posting
 * and reversal cancel each other out.
 */
export async function supplierStatement(db: PrismaClient, supplierId: string, opts: { from?: string; to?: string } = {}) {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, phone: true, address: true, contactPerson: true, taxNumber: true } });
  if (!supplier) return null;
  const party = await db.ledgerAccount.findUnique({ where: { supplierId } });
  const from = opts.from ? new Date(opts.from) : null;
  const to = opts.to ? new Date(`${opts.to}T23:59:59.999Z`) : null;
  const lines = party
    ? await db.journalLine.findMany({
        where: { accountId: party.id, entry: { document: { status: { not: "CANCELLED" } }, ...(to ? { date: { lte: to } } : {}) } },
        include: { entry: { include: { document: { select: { id: true, docNo: true, type: true, series: true, remarks: true, vendorBillNo: true } } } } },
        orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
      })
    : [];
  let opening = ZERO;
  let balance = ZERO;
  const rows: { date: string; docId: string; docNo: string; kind: string; reference: string | null; remarks: string | null; debit: string; credit: string; balance: string; remaining?: string }[] = [];
  for (const l of lines) {
    // Owed to the supplier goes up with a credit
    const amt = sub(fromPaisa(l.creditPaisa), fromPaisa(l.debitPaisa));
    if (from && l.entry.date < from) {
      opening = add(opening, amt);
      balance = opening;
      continue;
    }
    balance = add(balance, amt);
    const d = l.entry.document!;
    rows.push({
      date: l.entry.date.toISOString(), docId: d.id, docNo: d.docNo, kind: describe(d.type, d.series), reference: d.vendorBillNo, remarks: d.remarks,
      debit: toPlain(fromPaisa(l.debitPaisa)), credit: toPlain(fromPaisa(l.creditPaisa)), balance: toPlain(balance),
    });
  }
  for (const r of rows.filter((x) => x.kind === "Purchase bill")) r.remaining = (await billPayments(db, r.docId)).remaining;
  const totals = rows.reduce((t, r) => ({ debit: add(t.debit, dec(r.debit)), credit: add(t.credit, dec(r.credit)) }), { debit: ZERO, credit: ZERO });
  return {
    supplier, partyAccountId: party?.id ?? null, partyCode: party?.code ?? null, from: opts.from ?? null, to: opts.to ?? null,
    opening: toPlain(opening), rows, totalDebit: toPlain(totals.debit), totalCredit: toPlain(totals.credit), closing: toPlain(balance),
  };
}
