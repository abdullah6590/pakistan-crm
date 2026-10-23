// src/lib/sales/bill-view.ts - A saved sale bill as it is shown, printed and saved as PDF (one source for all three).
import type { PrismaClient } from "@prisma/client";
import { getSetting } from "@/lib/accounting/setup";
import { amountInWords } from "@/lib/domain/words";

export function rupeesInWords(total: number): string {
  const rupees = Math.floor(Math.abs(total));
  const paisa = Math.round((Math.abs(total) - rupees) * 100);
  const text = `${amountInWords(rupees)} Rupees`;
  return paisa ? `${text} and ${amountInWords(paisa)} Paisa Only` : `${text} Only`;
}

export async function loadBill(db: PrismaClient, id: string) {
  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      user: { select: { name: true } },
      items: { include: { component: { select: { name: true, sku: true } } } },
    },
  });
  if (!sale) return null;
  const [businessName, businessAddress, edits] = await Promise.all([
    getSetting(db, "BUSINESS_NAME"),
    getSetting(db, "BUSINESS_ADDRESS"),
    db.auditLog.findMany({ where: { entity: "Sale", entityId: id, action: "AMEND" }, orderBy: { createdAt: "asc" } }),
  ]);
  const editors = await db.user.findMany({ where: { id: { in: edits.map((e) => e.userId) } }, select: { id: true, name: true } });
  return {
    sale,
    businessName: businessName || "Paper Mill ERP",
    businessAddress: businessAddress || "",
    words: rupeesInWords(sale.total),
    edits: edits.map((e) => {
      const before = e.before ? JSON.parse(e.before) : null;
      const after = e.after ? JSON.parse(e.after) : null;
      return {
        id: e.id,
        at: e.createdAt,
        by: editors.find((u) => u.id === e.userId)?.name ?? "Unknown user",
        reason: e.reason,
        totalBefore: before?.total as number | undefined,
        totalAfter: after?.total as number | undefined,
      };
    }),
  };
}
