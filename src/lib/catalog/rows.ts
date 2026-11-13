// src/lib/catalog/rows.ts - A product as the Add New Product screen lists and edits it: the old list's columns (Id,
// Item Name, X, Y, gm, DV, Sup-Price, S-Price, Category, Rim, Rim-Qty, Sheet, T-Stock) from the unit profile.
import { unitConfigFor, type UnitSource } from "@/lib/accounting/posting";
import { toPacksAndLoose } from "@/lib/domain/units";
import { dec, toPlain } from "@/lib/domain/decimal";
import { packUnitOf } from "./units";

export const PRODUCT_ROW_FIELDS = {
  id: true, itemNo: true, name: true, sku: true, categoryId: true, supplierId: true, description: true,
  dimensionX: true, dimensionY: true, gsm: true, divisor: true, weightKg: true,
  ratePerKg: true, saleRatePerKg: true, unitCost: true, unitPrice: true, quantity: true, minQuantity: true,
  unit: true, rimInSheet: true, itemsPerPackage: true, packagingUnit: true,
  category: { select: { id: true, name: true, ratePerKg: true } },
  unitProfile: { include: { conversions: true } },
  _count: { select: { stockMovements: true } },
} as const;

type Row = UnitSource & {
  id: string; itemNo: number | null; name: string; sku: string; categoryId: string; supplierId?: string | null; description?: string | null;
  dimensionX: number | null; dimensionY: number | null; gsm: number | null; divisor: number | null; weightKg?: number | null;
  ratePerKg: number | null; saleRatePerKg: number | null; unitCost: number; unitPrice: number; quantity: number; minQuantity: number;
  category?: { id: string; name: string; ratePerKg: number | null } | null;
  _count?: { stockMovements: number };
};

export function productRow(p: Row) {
  const { cfg } = unitConfigFor(p);
  const pack = packUnitOf(cfg);
  const split = pack ? toPacksAndLoose(cfg, dec(p.quantity), pack.code) : null;
  return {
    id: p.id, itemNo: p.itemNo, name: p.name, sku: p.sku, categoryId: p.categoryId, category: p.category?.name ?? null,
    groupRatePerKg: p.category?.ratePerKg ?? null, supplierId: p.supplierId ?? null, description: p.description ?? null,
    kind: cfg.kind, baseUnit: cfg.baseUnit, packCode: pack?.code ?? null, packSize: pack?.factor ?? null,
    dimensionX: p.dimensionX, dimensionY: p.dimensionY, gsm: p.gsm, divisor: p.divisor ?? 15500,
    purchaseRatePerKg: p.ratePerKg, saleRatePerKg: p.saleRatePerKg, purchasePrice: p.unitCost, salePrice: p.unitPrice,
    stock: p.quantity, stockPacks: split ? Number(toPlain(split.packs)) : null, stockLoose: split ? Number(toPlain(split.loose)) : null,
    reorderLevel: pack ? Math.round(p.minQuantity / pack.factor) : p.minQuantity,
    /** Packet size and kind are locked once stock has moved */
    locked: (p._count?.stockMovements ?? 0) > 0,
  };
}
export type ProductRow = ReturnType<typeof productRow>;
