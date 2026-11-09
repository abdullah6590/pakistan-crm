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

export interface PaperLine {
  paperX?: string | null;
  paperY?: string | null;
  paperGsm?: string | null;
  paperDivisor?: string | null;
  kgPerUnit?: string | null;
  ratePerKg?: string | null;
  unit?: string | null;
  baseQuantity?: string | null;
}

const short = (v: string | number, dp: number) => Number(v).toLocaleString("en-PK", { maximumFractionDigits: dp });

/** How a paper line was priced, as on the old Supplier Invoice: "18 x 25 in · 300 g · 8.7097 kg/rim · Rs 135.5/kg". */
export function paperLineText(l: PaperLine | null | undefined): string {
  if (!l?.paperX || !l.paperY || !l.paperGsm) return "";
  return [
    `${short(l.paperX, 3)} x ${short(l.paperY, 3)} in`,
    `${short(l.paperGsm, 2)} g`,
    l.kgPerUnit ? `${short(l.kgPerUnit, 4)} kg/${l.unit || "unit"}` : null,
    l.ratePerKg ? `Rs ${short(l.ratePerKg, 4)}/kg` : null,
  ].filter(Boolean).join(" · ");
}

/** Weight of the whole line in kg: kg of one sheet (X x Y x GSM / divisor / 100) times the sheets bought. */
export function paperLineWeight(l: PaperLine | null | undefined): number {
  if (!l?.paperX || !l.paperY || !l.paperGsm || !l.baseQuantity) return 0;
  const divisor = Number(l.paperDivisor) || 15500;
  return (Number(l.paperX) * Number(l.paperY) * Number(l.paperGsm)) / divisor / 100 * Number(l.baseQuantity);
}
