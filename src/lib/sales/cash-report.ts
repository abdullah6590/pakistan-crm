// src/lib/sales/cash-report.ts - The old program's Cash Report (Report 32 B.13, Report 33): cash sales between dates,
// cash sales still owing (any date), unpaid between dates, all cash sales, and a day book with each bill's lines.
// Paid counts the cash taken at the counter plus any later Cash Update receipts.
import type { PrismaClient } from "@prisma/client";
import { listBills } from "./books-queries";
import { quantityLabel } from "@/lib/domain/units";

export const CASH_REPORT_MODES = ["dates", "owing", "unpaid", "all"] as const;
export type CashReportMode = (typeof CASH_REPORT_MODES)[number];

export async function cashReport(db: PrismaClient, mode: CashReportMode, range: { from?: string; to?: string } = {}) {
  const dated = mode === "dates" || mode === "unpaid";
  const { rows } = await listBills(db, { type: "CASH_SALE", ...(dated ? range : {}) }, 100_000);
  const picked = mode === "owing" || mode === "unpaid" ? rows.filter((r) => Number(r.remaining) > 0) : rows;
  const totals = picked.reduce((t, r) => ({ total: t.total + Number(r.total), paid: t.paid + Number(r.paid), remaining: t.remaining + Number(r.remaining) }), { total: 0, paid: 0, remaining: 0 });
  return { rows: picked, totals: { count: picked.length, ...totals } };
}

/** The day book: each cash sale between the dates with its lines (item, quantity as billed, price, amount, remark). */
export async function cashDayBook(db: PrismaClient, range: { from?: string; to?: string }) {
  const { rows } = await cashReport(db, "dates", range);
  const docs = await db.accountingDocument.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: { lines: { orderBy: { lineNo: "asc" }, select: { description: true, quantity: true, unit: true, loose: true, unitPrice: true, amount: true, remarks: true } } },
  });
  const linesOf = new Map(docs.map((d) => [d.id, d.lines]));
  return rows.map((r) => ({
    ...r,
    lines: (linesOf.get(r.id) ?? []).map((l) => ({ item: l.description ?? "", quantity: quantityLabel(l.quantity, l.unit, l.loose), price: l.unitPrice, amount: l.amount, remarks: l.remarks })),
  }));
}
