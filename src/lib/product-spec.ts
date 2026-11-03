// src/lib/product-spec.ts - A product's size and grams as shown in product lists and on bills ("20x39 · 200g"), and the
// fields the price calculator works from (the same formula on Inventory, New Sale and New Purchase).

/** Fields to load with an item for its size/grams label and the price calculator. */
export const SPEC_FIELDS = {
  size: true, grams: true, dimensionX: true, dimensionY: true, gsm: true, divisor: true, weightKg: true, ratePerKg: true,
} as const;

export interface ProductSpec {
  size?: string | null;
  grams?: number | null;
  dimensionX?: number | null;
  dimensionY?: number | null;
  gsm?: number | null;
  divisor?: number | null;
  weightKg?: number | null;
  ratePerKg?: number | null;
  rimInSheet?: number | null;
}

/** "20x39 · 200g", "20x39", "200g" or "" when the item has neither. */
export function specLabel(p: Pick<ProductSpec, "size" | "grams"> | null | undefined): string {
  if (!p) return "";
  return [p.size?.trim(), p.grams ? `${Number(p.grams)}g` : ""].filter(Boolean).join(" · ");
}
