// src/lib/search.ts - The global search: customers, suppliers, products, sale bills, purchase bills and payments.
// Ranked inside the database (exact match, then starts with, then a word starts with, then contains) and paged, so
// only the rows shown are read, however large the business grows. Read-only.
import type { PrismaClient } from "@prisma/client";
import { add, fromPaisa, isNegative, sub, toPlain, ZERO } from "@/lib/domain/decimal";
import { specLabel } from "@/lib/product-spec";

export const SEARCH_GROUPS = ["customers", "suppliers", "products", "sales", "purchases", "payments"] as const;
export type SearchGroupId = (typeof SEARCH_GROUPS)[number];

/** Which permission each group needs (the same as its own screens). */
export const GROUP_RESOURCE: Record<SearchGroupId, string> = {
  customers: "customers", suppliers: "suppliers", products: "inventory", sales: "sales", purchases: "purchases", payments: "ledgers",
};

export interface SearchHit {
  id: string;
  group: SearchGroupId;
  title: string;
  subtitle: string;
  /** Short extra facts, e.g. "Stock 120 piece" or "Owes Rs 7,000" */
  badges: { text: string; tone?: "good" | "warn" | "bad" | "muted" }[];
  amount: string | null;
  date: string | null;
  href: string;
  /** 0 exact, 1 starts with, 2 a word starts with, 3 contains elsewhere */
  rank: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface Spec {
  /** SELECT list and FROM clause, with `x` as the main table */
  select: string;
  from: string;
  /** The column the ranking looks at first (name, bill number) */
  primary: string;
  /** Columns any word may match */
  columns: string[];
  extraWhere?: string;
  order: string;
}

const CURRENT_DOC = `NOT EXISTS (SELECT 1 FROM accounting_documents n WHERE n.supersedesId = x.id) AND x.status IN ('POSTED','CANCELLED')`;
const SPECS: Record<SearchGroupId, Spec> = {
  customers: {
    select: "x.id, x.name, x.phone, x.city, x.isActive",
    from: "customers x", primary: "x.name", columns: ["x.name", "x.phone", "x.email", "x.city"], order: "x.isActive DESC, x.name",
  },
  suppliers: {
    select: "x.id, x.name, x.company, x.contactPerson, x.phone, x.city, x.isActive",
    from: "suppliers x", primary: "x.name", columns: ["x.name", "x.company", "x.contactPerson", "x.phone", "x.city"], order: "x.isActive DESC, x.name",
  },
  products: {
    select: "x.id, x.name, x.sku, x.size, x.grams, x.quantity, x.unit, x.isActive",
    from: "components x", primary: "x.name", columns: ["x.name", "x.sku", "x.size"], order: "x.isActive DESC, x.name",
  },
  sales: {
    select: "x.id, x.docNo, x.type, x.status, x.date, x.total, p.name AS party",
    from: "accounting_documents x LEFT JOIN ledger_accounts p ON p.id = x.partyAccountId",
    primary: "x.docNo", columns: ["x.docNo", "p.name", "x.remarks"], extraWhere: `x.type IN ('SALE_INVOICE','CASH_SALE') AND ${CURRENT_DOC}`, order: "x.date DESC",
  },
  purchases: {
    select: "x.id, x.docNo, x.status, x.date, x.total, x.vendorBillNo, p.name AS party",
    from: "accounting_documents x LEFT JOIN ledger_accounts p ON p.id = x.partyAccountId",
    primary: "x.docNo", columns: ["x.docNo", "x.vendorBillNo", "p.name", "x.remarks"], extraWhere: `x.type = 'PURCHASE_INVOICE' AND ${CURRENT_DOC}`, order: "x.date DESC",
  },
  payments: {
    select: "x.id, x.docNo, x.status, x.date, x.total, x.remarks, p.name AS party",
    from: "accounting_documents x LEFT JOIN ledger_accounts p ON p.id = x.partyAccountId",
    primary: "x.docNo", columns: ["x.docNo", "p.name", "x.remarks"], extraWhere: `x.type = 'VOUCHER' AND ${CURRENT_DOC}`, order: "x.date DESC",
  },
};

type Row = Record<string, unknown> & { id: string; rank: number | bigint };

/** One page of matches for one group, best first. `hasMore` says whether "Show more" has anything to show. */
async function queryGroup(db: PrismaClient, group: SearchGroupId, q: string, skip: number, take: number) {
  const spec = SPECS[group];
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const args: unknown[] = [];
  // Every word must match one of the columns
  const wordClauses = words.map((w) => {
    const like = `%${escapeLike(w)}%`;
    return `(${spec.columns.map((c) => { args.push(like); return `${c} LIKE ? ESCAPE '\\'`; }).join(" OR ")})`;
  });
  const whereArgs = [...args];
  const rankArgs = [q, `${escapeLike(q)}%`, `% ${escapeLike(q)}%`];
  const sql = `SELECT ${spec.select},
      CASE WHEN lower(${spec.primary}) = lower(?) THEN 0 WHEN ${spec.primary} LIKE ? ESCAPE '\\' THEN 1 WHEN ${spec.primary} LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END AS rank
    FROM ${spec.from}
    WHERE ${[spec.extraWhere, ...wordClauses].filter(Boolean).join(" AND ") || "1 = 1"}
    ORDER BY rank, ${spec.order}
    LIMIT ? OFFSET ?`;
  const rows = await db.$queryRawUnsafe<Row[]>(sql, ...rankArgs, ...whereArgs, take + 1, skip);
  return { rows: rows.slice(0, take), hasMore: rows.length > take };
}

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
};
const day = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

/** Balances of the ledger accounts linked to these customers or suppliers (debit positive). */
async function partyBalances(db: PrismaClient, field: "customerId" | "supplierId", ids: string[]) {
  if (!ids.length) return new Map<string, bigint>();
  const accounts = await db.ledgerAccount.findMany({ where: { [field]: { in: ids } }, select: { id: true, customerId: true, supplierId: true } });
  const sums = accounts.length
    ? await db.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: accounts.map((a) => a.id) } }, _sum: { debitPaisa: true, creditPaisa: true } })
    : [];
  const byAccount = new Map(sums.map((x) => [x.accountId, fromPaisa((x._sum.debitPaisa ?? BigInt(0)) - (x._sum.creditPaisa ?? BigInt(0)))]));
  const result = new Map<string, bigint>();
  for (const a of accounts) result.set((a[field] as string), add(ZERO, byAccount.get(a.id) ?? ZERO));
  return result;
}

async function toHits(db: PrismaClient, group: SearchGroupId, rows: Row[]): Promise<SearchHit[]> {
  const rank = (r: Row) => Number(r.rank);
  if (group === "customers") {
    const bal = await partyBalances(db, "customerId", rows.map((r) => r.id));
    return rows.map((r) => {
      const b = bal.get(r.id) ?? ZERO;
      const badges: SearchHit["badges"] = [];
      if (b > ZERO) badges.push({ text: `Owes ${money(toPlain(b))}`, tone: "warn" });
      else if (isNegative(b)) badges.push({ text: `Advance ${money(toPlain(sub(ZERO, b)))}`, tone: "good" });
      if (!Number(r.isActive)) badges.push({ text: "Archived", tone: "muted" });
      return { id: r.id, group, title: String(r.name), subtitle: [r.phone, r.city].filter(Boolean).join(" · ") || "Customer", badges, amount: null, date: null, href: `/dashboard/customers/${r.id}/ledger`, rank: rank(r) };
    });
  }
  if (group === "suppliers") {
    const bal = await partyBalances(db, "supplierId", rows.map((r) => r.id));
    return rows.map((r) => {
      const b = bal.get(r.id) ?? ZERO;
      const badges: SearchHit["badges"] = [];
      if (isNegative(b)) badges.push({ text: `You owe ${money(toPlain(sub(ZERO, b)))}`, tone: "warn" });
      else if (b > ZERO) badges.push({ text: `Advance ${money(toPlain(b))}`, tone: "good" });
      if (!Number(r.isActive)) badges.push({ text: "Archived", tone: "muted" });
      return { id: r.id, group, title: String(r.name), subtitle: [r.company, r.contactPerson, r.phone].filter(Boolean).join(" · ") || "Supplier", badges, amount: null, date: null, href: `/dashboard/suppliers/${r.id}`, rank: rank(r) };
    });
  }
  if (group === "products") {
    return rows.map((r) => {
      const qty = Number(r.quantity ?? 0);
      const badges: SearchHit["badges"] = [{ text: `Stock ${qty.toLocaleString("en-PK")} ${r.unit ?? ""}`.trim(), tone: qty > 0 ? "good" : "bad" }];
      if (!Number(r.isActive)) badges.push({ text: "Archived", tone: "muted" });
      const spec = specLabel({ size: r.size as string | null, grams: r.grams as number | null });
      return { id: r.id, group, title: spec ? `${r.name}  ·  ${spec}` : String(r.name), subtitle: String(r.sku ?? ""), badges, amount: null, date: null, href: `/dashboard/inventory/${r.id}`, rank: rank(r) };
    });
  }
  return rows.map((r) => {
    const cancelled = r.status === "CANCELLED";
    const badges: SearchHit["badges"] = cancelled ? [{ text: "Cancelled", tone: "bad" }] : [];
    if (group === "sales" && r.type === "CASH_SALE") badges.push({ text: "Cash sale", tone: "muted" });
    const href = group === "sales" ? `/dashboard/sales/${r.id}` : group === "purchases" ? `/dashboard/purchases/${r.id}` : `/dashboard/accounting/documents/${r.id}`;
    const subtitle = [r.party ?? (group === "sales" ? "Walk-in" : null), group === "purchases" && r.vendorBillNo ? `Supplier bill ${r.vendorBillNo}` : null, group === "payments" ? r.remarks : null].filter(Boolean).join(" · ");
    return { id: r.id, group, title: String(r.docNo), subtitle, badges, amount: money(r.total), date: day(r.date), href, rank: rank(r) };
  });
}

/** One group, page by page ("Show more"). */
export async function searchGroup(db: PrismaClient, group: SearchGroupId, q: string, skip = 0, take = 8) {
  const { rows, hasMore } = await queryGroup(db, group, q, skip, take);
  return { group, hits: await toHits(db, group, rows), hasMore };
}

/** Every allowed group at once (the first few of each) and the single best match. */
export async function searchAll(db: PrismaClient, q: string, groups: readonly SearchGroupId[], perGroup = 4) {
  const results = await Promise.all(groups.map((g) => searchGroup(db, g, q, 0, perGroup)));
  // Best match: the lowest rank; at equal rank, the order of the groups (bill numbers and people before products)
  let best: SearchHit | null = null;
  for (const r of results) for (const h of r.hits) if (!best || h.rank < best.rank) best = h;
  return { groups: results, best: best && best.rank <= 2 ? best : null };
}
