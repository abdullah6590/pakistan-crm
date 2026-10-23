// src/lib/domain/stock.ts - Negative-stock policy (owner decision OD-04).
// Legacy never blocked overselling. Approved behaviour: allow it, warn, and record it for reporting.
import { Dec, add, cmp, ZERO, isNegative } from "./decimal";

export type NegativeStockPolicy = "ALLOW_WITH_WARNING" | "ALLOW_SILENT" | "BLOCK";

export const DEFAULT_NEGATIVE_STOCK_POLICY: NegativeStockPolicy = "ALLOW_WITH_WARNING";

export interface StockMovementResult {
  allowed: boolean;
  balanceBefore: Dec;
  balanceAfter: Dec;
  /** Present when the movement leaves the item below zero and the policy records it. */
  warning?: { message: string; balanceAfter: Dec };
}

/** Apply a signed movement (negative = outflow) to an item's balance under the configured policy. */
export function applyMovement(
  balanceBefore: Dec,
  delta: Dec,
  policy: NegativeStockPolicy = DEFAULT_NEGATIVE_STOCK_POLICY
): StockMovementResult {
  const balanceAfter = add(balanceBefore, delta);
  const goesNegative = isNegative(balanceAfter) && cmp(delta, ZERO) < 0;
  if (!goesNegative) return { allowed: true, balanceBefore, balanceAfter };
  if (policy === "BLOCK") return { allowed: false, balanceBefore, balanceAfter: balanceBefore };
  if (policy === "ALLOW_SILENT") return { allowed: true, balanceBefore, balanceAfter };
  return {
    allowed: true,
    balanceBefore,
    balanceAfter,
    warning: { message: "Stock for this item is now below zero", balanceAfter },
  };
}
