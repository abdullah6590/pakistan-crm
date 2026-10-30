// src/lib/sales/units.ts - The units an item is sold in, for the Sales screens: its stock unit and any configured pack
// units (packet, carton, ...), with how many stock units each holds (Books item units, Report 15 F-01).
import { unitConfigFor, type UnitSource } from "@/lib/accounting/posting";

/** Fields to load with an item so its units can be worked out. */
export const UNIT_FIELDS = {
  unit: true, packagingUnit: true, itemsPerPackage: true, rimInSheet: true,
  unitProfile: { include: { conversions: true } },
} as const;

export interface SaleUnits {
  baseUnit: string;
  /** Unit offered first on a bill (the item's sale unit, or the stock unit). */
  saleUnit: string;
  /** Unit offered first on a purchase bill (the item's buying unit, or the stock unit). */
  purchaseUnit: string;
  units: { code: string; factor: number }[];
}

export function saleUnitsOf(c: UnitSource): SaleUnits {
  const { cfg } = unitConfigFor(c);
  return {
    baseUnit: cfg.baseUnit,
    saleUnit: cfg.saleUnit ?? cfg.baseUnit,
    purchaseUnit: cfg.purchaseUnit ?? cfg.baseUnit,
    units: [...(cfg.conversions ?? []).map((u) => ({ code: u.code, factor: Number(u.factor) })), { code: cfg.baseUnit, factor: 1 }],
  };
}

/** An item as loaded with UNIT_FIELDS, with its units added and the raw unit profile left out. */
export function withSaleUnits<T extends UnitSource>(c: T): Omit<T, "unitProfile"> & SaleUnits {
  const rest: Partial<T> = { ...c };
  delete rest.unitProfile;
  return { ...(rest as Omit<T, "unitProfile">), ...saleUnitsOf(c) };
}
