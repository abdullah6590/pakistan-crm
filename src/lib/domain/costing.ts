// src/lib/domain/costing.ts - Inventory cost (owner decision OD-03, Report 10 TQ-01).
// Method: perpetual moving weighted-average cost per base unit, from recorded purchase costs.
// Legacy recorded cost only for paper (weight x item rate/kg) and effectively zero for other items;
// that figure is kept separately for parity (legacyPaperUnitCost) and never mixed with new costs.
import { Dec, dec, ZERO, add, sub, mul, div, cmp, isNegative } from "./decimal";

export type CostStatus = "ACTUAL" | "ESTIMATED" | "UNAVAILABLE";

export interface CostState {
  /** Stock on hand in the base unit (may be negative; OD-04). */
  onHand: Dec;
  /** Weighted-average cost per base unit, or null when no cost has ever been recorded. */
  averageCost: Dec | null;
}

export const EMPTY_COST_STATE: CostState = { onHand: ZERO, averageCost: null };

/** Receipt of stock at a known cost per base unit (purchase, return to stock). */
export function receive(state: CostState, quantity: Dec, unitCost: Dec): CostState {
  if (cmp(quantity, ZERO) <= 0) throw new Error("Received quantity must be positive");
  if (isNegative(unitCost)) throw new Error("Unit cost cannot be negative");
  const newOnHand = add(state.onHand, quantity);
  // When nothing valued is on hand (zero or negative stock), the incoming cost becomes the average.
  if (state.averageCost === null || cmp(state.onHand, ZERO) <= 0) {
    return { onHand: newOnHand, averageCost: unitCost };
  }
  const value = add(mul(state.onHand, state.averageCost), mul(quantity, unitCost));
  return { onHand: newOnHand, averageCost: div(value, newOnHand) };
}

/**
 * Receipt whose cost is unknown (e.g. printed goods made from uncosted material). The quantity is added
 * without changing the average, so no value is invented; callers mark the movement UNAVAILABLE.
 */
export function receiveUncosted(state: CostState, quantity: Dec): CostState {
  if (cmp(quantity, ZERO) <= 0) throw new Error("Received quantity must be positive");
  return { onHand: add(state.onHand, quantity), averageCost: state.averageCost };
}

/**
 * Undo an earlier receipt when its document is cancelled: removes the quantity and the value it added.
 * When stock left afterwards is zero or negative the average is kept, as `receive` does.
 */
export function reverseReceipt(state: CostState, quantity: Dec, value: Dec | null): CostState {
  if (cmp(quantity, ZERO) <= 0) throw new Error("Reversed quantity must be positive");
  const onHand = sub(state.onHand, quantity);
  if (state.averageCost === null || value === null || cmp(onHand, ZERO) <= 0) return { onHand, averageCost: state.averageCost };
  const remaining = sub(mul(state.onHand, state.averageCost), value);
  return { onHand, averageCost: isNegative(remaining) ? ZERO : div(remaining, onHand) };
}

export interface IssueCost {
  state: CostState;
  /** Total cost of the issued quantity, or null when it cannot be established. */
  cost: Dec | null;
  status: CostStatus;
  /** Plain-language reason when the cost is not ACTUAL. */
  note?: string;
}

/**
 * Issue of stock (sale, cash sale, stock issue). Cost is ACTUAL when valued stock covers the quantity,
 * ESTIMATED when part of it goes below zero or only a fallback price is known, and UNAVAILABLE when no
 * cost information exists at all.
 */
export function issue(state: CostState, quantity: Dec, fallbackUnitCost?: Dec | null): IssueCost {
  if (cmp(quantity, ZERO) <= 0) throw new Error("Issued quantity must be positive");
  const onHand = sub(state.onHand, quantity);
  const next: CostState = { onHand, averageCost: state.averageCost };

  if (state.averageCost !== null) {
    const cost = mul(quantity, state.averageCost);
    if (cmp(state.onHand, quantity) >= 0) return { state: next, cost, status: "ACTUAL" };
    return {
      state: next,
      cost,
      status: "ESTIMATED",
      note: "Issued quantity exceeds valued stock on hand; cost uses the current average",
    };
  }
  if (fallbackUnitCost !== undefined && fallbackUnitCost !== null) {
    return {
      state: next,
      cost: mul(quantity, fallbackUnitCost),
      status: "ESTIMATED",
      note: "No purchase cost recorded; cost uses the item's reference purchase price",
    };
  }
  return { state: next, cost: null, status: "UNAVAILABLE", note: "No cost information for this item" };
}

export type ReferenceCostInput =
  /** Paper: real packet weight (OD-02) x (purchase rate per kg + expenses per kg). */
  | { kind: "PAPER"; packetWeightKg: Dec; ratePerKg: number | string | null; expensePerKg?: number | string | null }
  /** Other items: purchase price per pack (or per base unit) + expenses per pack (P-Price = Sup + Exp). */
  | { kind: "OTHER"; purchasePrice: number | string | null; expenses?: number | string | null };

/**
 * F-02 (Report 13 D-I): reference purchase cost of one pack, used only as the ESTIMATED fallback in
 * `issue` when no purchase cost has been recorded. Returns null when no purchase price/rate is known,
 * so the cost is reported UNAVAILABLE rather than invented.
 */
export function referenceCostPerPack(input: ReferenceCostInput): Dec | null {
  const opt = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? ZERO : dec(v));
  if (input.kind === "PAPER") {
    if (input.ratePerKg === null || input.ratePerKg === "") return null;
    const rate = add(dec(input.ratePerKg), opt(input.expensePerKg));
    if (isNegative(rate)) throw new Error("Reference cost cannot be negative");
    return mul(input.packetWeightKg, rate);
  }
  if (input.purchasePrice === null || input.purchasePrice === "") return null;
  const cost = add(dec(input.purchasePrice), opt(input.expenses));
  if (isNegative(cost)) throw new Error("Reference cost cannot be negative");
  return cost;
}

/** Legacy APrice for paper: weight per 100 sheets x item purchase rate per kg (itm.itmpp, ItmExp = 0). */
export function legacyPaperUnitCost(weightPer100Kg: Dec, ratePerKg: number | string): Dec {
  return mul(weightPer100Kg, dec(ratePerKg));
}

/** Legacy Prf (line cost, misnamed "profit" in the old database): APrice*CbQ + APrice/Box*Qty. */
export function legacyLineCost(aprice: number, cbq: number, box: number, qty: number): Dec {
  const a = dec(aprice);
  return add(mul(a, dec(cbq)), mul(div(a, dec(box)), dec(qty)));
}
