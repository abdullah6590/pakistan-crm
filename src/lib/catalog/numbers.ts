// src/lib/catalog/numbers.ts - Short numbers for products and parties, as the old program had (Report 32 B.4, B.5).
// A number comes from a counter row incremented inside the same transaction as the save (SQLite serialises writers),
// never from MAX(id) + 1; the unique index on the column is the last guard. Only the main server gives numbers
// (a syncing computer receives them with the rows).
import type { Prisma } from "@prisma/client";
import { nextNumber } from "@/lib/accounting/posting";

type Tx = Prisma.TransactionClient;

/** Counter rows in `document_series`. Customers and suppliers share one sequence, like the old SubCode. */
export const ITEM_SERIES = "#ITEM_NO";
export const PARTY_SERIES = "#PARTY_NO";

export const nextItemNo = (tx: Tx) => nextNumber(tx, ITEM_SERIES);
export const nextPartyNo = (tx: Tx) => nextNumber(tx, PARTY_SERIES);

/** A typed product or party number: digits only (leading zeros allowed), else null. */
export function parseShortNo(text: string | null | undefined): number | null {
  const t = (text ?? "").trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}
