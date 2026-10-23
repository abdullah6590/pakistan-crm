// src/lib/domain/rounding.ts - Document totals (Report 10 TQ-05; owner decision OD-01).
// Legacy printed sale-invoice totals rounded to whole rupees, half-to-even, while its ledger posted the
// exact line sum. Approved change: the party ledger receives the same rounded total that is printed,
// and the difference is recorded as an explicit rounding adjustment so the books still balance.
import { Dec, sum, sub, roundHalfEven } from "./decimal";

export type TotalRounding = "RUPEE_HALF_EVEN" | "PAISA_HALF_EVEN";

export interface DocumentTotal {
  /** Exact sum of the line amounts (kept for audit and costing). */
  exact: Dec;
  /** Amount printed on the document and posted to the party. */
  total: Dec;
  /** total - exact; posted to the rounding account. */
  roundingAdjustment: Dec;
}

export function documentTotal(lineAmounts: Dec[], mode: TotalRounding): DocumentTotal {
  const exact = sum(lineAmounts);
  const total = roundHalfEven(exact, mode === "RUPEE_HALF_EVEN" ? 0 : 2);
  return { exact, total, roundingAdjustment: sub(total, exact) };
}

/** Default rounding per document type. Sale-type documents follow the verified legacy printed total.
 *  Purchases were never rounded in the legacy system (vinvCr kept fractions); see Report 10 RQ-01. */
export const DEFAULT_TOTAL_ROUNDING: Record<string, TotalRounding> = {
  SALE_INVOICE: "RUPEE_HALF_EVEN",
  CASH_SALE: "RUPEE_HALF_EVEN",
  PURCHASE_INVOICE: "PAISA_HALF_EVEN",
};

/** Legacy Cinv.TVal: Math.Round(sum of NetAm) to whole rupees, half-to-even. */
export function legacyInvoiceTotal(lineAmounts: Dec[]): Dec {
  return roundHalfEven(sum(lineAmounts), 0);
}
