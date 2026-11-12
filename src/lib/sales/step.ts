// src/lib/sales/step.ts - The << < > >> buttons of the old Customer Invoice and Cash Sale screens: step through bills
// of one kind by number. Only the current version of each bill counts (an edited bill keeps its number, OD-11).
import type { PrismaClient } from "@prisma/client";

export const STEP_TYPES = ["SALE_INVOICE", "CASH_SALE"] as const;
export type StepType = (typeof STEP_TYPES)[number];
export type StepDirection = "first" | "prev" | "next" | "last";

/** The bill to show after pressing a step button from `fromId` (none: from a new, unsaved bill). Null at either end. */
export async function stepBill(db: PrismaClient, type: StepType, dir: StepDirection, fromId?: string | null): Promise<{ id: string; docNo: string } | null> {
  const current = { type, supersededBy: { is: null } };
  const select = { id: true, docNo: true } as const;
  const from = fromId ? await db.accountingDocument.findUnique({ where: { id: fromId }, select: { number: true, type: true } }) : null;
  // From a new bill, "previous" is the last one saved and "next" has nothing after it
  if (dir === "first") return db.accountingDocument.findFirst({ where: current, orderBy: { number: "asc" }, select });
  if (dir === "last" || (dir === "prev" && !from)) return db.accountingDocument.findFirst({ where: current, orderBy: { number: "desc" }, select });
  if (!from || from.type !== type) return null;
  return dir === "prev"
    ? db.accountingDocument.findFirst({ where: { ...current, number: { lt: from.number } }, orderBy: { number: "desc" }, select })
    : db.accountingDocument.findFirst({ where: { ...current, number: { gt: from.number } }, orderBy: { number: "asc" }, select });
}
