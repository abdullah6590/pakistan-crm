// src/lib/domain/units.ts - Item units and quantity conversion (owner decisions OD-06 / D-C, Reports 13 and 15 F-01).
// Every item has one base (stock) unit and any number of configured larger units with an explicit
// conversion factor, e.g. a carton of 2000 cups or a packet of 100 sheets. This mirrors the legacy
// "Catan" (packs) x "C in Q" (units per pack) + "Qty" (loose units) entry, which applied to all stocked
// goods, not only paper. Only paper additionally derives prices from weight (pricing.ts).
import { Dec, dec, ZERO, add, mul, div, hasAtMostDecimals, isNegative, cmp, isZero, toPlain } from "./decimal";

export type ItemKind = "PAPER" | "PIECE" | "WEIGHT" | "ROLL" | "SERVICE";

export interface UnitConversion {
  /** Unit code used on documents, e.g. "carton", "packet", "kg". */
  code: string;
  /** Base units contained in one of this unit (legacy "C in Q"). */
  factor: number | string;
  /** Decimal places allowed when entering this unit (default 0). */
  decimals?: number;
}

export interface ItemUnitConfig {
  /** Pricing behaviour. PAPER enables weight-based pricing; other kinds price per entered unit. */
  kind: ItemKind;
  /** Stock unit, e.g. "sheet", "piece", "kg", "roll", "service". */
  baseUnit: string;
  /** Decimal places allowed in the base unit (kg: 3; countable units: 0). */
  baseDecimals?: number;
  /** Larger units with their conversion to the base unit. */
  conversions?: UnitConversion[];
  /** Default units offered on purchase and sale documents (a conversion code or the base unit). */
  purchaseUnit?: string;
  saleUnit?: string;
  /** False until the owner has confirmed the mapping (Report 13 D-C); shown as "unit unconfirmed". */
  confirmed?: boolean;
}

/** A quantity as entered on a document line. */
export interface QuantityEntry {
  quantity: number | string;
  /** Unit of `quantity`; defaults to the base unit. */
  unit?: string;
  /** Loose base units added to a pack quantity (legacy "Qty"); only allowed with a pack unit. */
  loose?: number | string;
}

export const DEFAULT_UNITS: Record<ItemKind, ItemUnitConfig> = {
  PAPER: { kind: "PAPER", baseUnit: "sheet", baseDecimals: 0, conversions: [{ code: "packet", factor: 100 }], purchaseUnit: "packet", saleUnit: "packet" },
  PIECE: { kind: "PIECE", baseUnit: "piece", baseDecimals: 0 },
  WEIGHT: { kind: "WEIGHT", baseUnit: "kg", baseDecimals: 3 },
  ROLL: { kind: "ROLL", baseUnit: "roll", baseDecimals: 0 },
  SERVICE: { kind: "SERVICE", baseUnit: "service", baseDecimals: 0 },
};

export class QuantityError extends Error {}

export function validateUnitConfig(cfg: ItemUnitConfig): void {
  if (!cfg.baseUnit) throw new QuantityError("Every item needs a base (stock) unit");
  const baseDecimals = cfg.baseDecimals ?? 0;
  if (!Number.isInteger(baseDecimals) || baseDecimals < 0 || baseDecimals > 3) throw new QuantityError("Base unit decimals must be 0 to 3");
  const codes = new Set<string>([cfg.baseUnit]);
  for (const c of cfg.conversions ?? []) {
    if (!c.code) throw new QuantityError("Unit conversions need a unit code");
    if (codes.has(c.code)) throw new QuantityError(`Unit "${c.code}" is defined more than once`);
    codes.add(c.code);
    const f = dec(c.factor);
    if (cmp(f, ZERO) <= 0) throw new QuantityError(`Unit "${c.code}" needs a positive conversion factor`);
  }
  for (const u of [cfg.purchaseUnit, cfg.saleUnit]) {
    if (u !== undefined && !codes.has(u)) throw new QuantityError(`Default unit "${u}" is not defined for this item`);
  }
  if (cfg.kind === "PAPER" && !(cfg.conversions ?? []).length) {
    throw new QuantityError("Paper items need a packet size (sheets per packet)");
  }
}

/** Base units per one of `unit` (1 for the base unit). */
export function unitFactor(cfg: ItemUnitConfig, unit?: string): Dec {
  if (unit === undefined || unit === cfg.baseUnit) return dec(1);
  const c = (cfg.conversions ?? []).find((x) => x.code === unit);
  if (!c) throw new QuantityError(`Unit "${unit}" is not defined for this item`);
  return dec(c.factor);
}

function unitDecimals(cfg: ItemUnitConfig, unit?: string): number {
  if (unit === undefined || unit === cfg.baseUnit) return cfg.baseDecimals ?? 0;
  return (cfg.conversions ?? []).find((x) => x.code === unit)?.decimals ?? 0;
}

/** Convert an entered quantity to the item's base unit, validating it for the item. */
export function toBaseQuantity(cfg: ItemUnitConfig, entry: QuantityEntry): Dec {
  validateUnitConfig(cfg);
  const qty = dec(entry.quantity);
  const loose = entry.loose === undefined || entry.loose === "" ? ZERO : dec(entry.loose);
  if (isNegative(qty) || isNegative(loose)) throw new QuantityError("Quantities cannot be negative");

  const unit = entry.unit ?? cfg.baseUnit;
  const factor = unitFactor(cfg, unit);
  const qtyDecimals = unitDecimals(cfg, unit);
  if (!hasAtMostDecimals(qty, qtyDecimals)) {
    throw new QuantityError(qtyDecimals === 0 ? `${unit} quantities must be whole numbers` : `${unit} quantities allow at most ${qtyDecimals} decimal places`);
  }
  const baseDecimals = cfg.baseDecimals ?? 0;
  if (!isZero(loose)) {
    if (unit === cfg.baseUnit) throw new QuantityError(`Loose ${cfg.baseUnit} quantities are only used together with a pack unit`);
    if (!hasAtMostDecimals(loose, baseDecimals)) throw new QuantityError(`Loose ${cfg.baseUnit} quantities allow at most ${baseDecimals} decimal places`);
    if (cmp(loose, factor) >= 0) throw new QuantityError(`Loose ${cfg.baseUnit} must be fewer than one ${unit} (${toPlain(factor)}); enter whole ${unit}s instead`);
  }
  const base = add(mul(qty, factor), loose);
  if (!hasAtMostDecimals(base, baseDecimals)) {
    throw new QuantityError(`This quantity does not convert to a whole number of ${cfg.baseUnit}s`);
  }
  return base;
}

/** Split a base-unit stock quantity into whole packs + loose base units for display. */
export function toPacksAndLoose(cfg: ItemUnitConfig, base: Dec, unit?: string): { packs: Dec; loose: Dec; unit: string } | null {
  const code = unit ?? cfg.conversions?.[0]?.code;
  if (!code || code === cfg.baseUnit) return null;
  const factor = unitFactor(cfg, code);
  const sign = isNegative(base) ? -BigInt(1) : BigInt(1);
  const absBase = isNegative(base) ? -base : base;
  const packs = (absBase / factor) * dec(1);
  const loose = absBase - mul(packs, factor);
  return { packs: sign * packs, loose: sign * loose, unit: code };
}

/** Price per base unit for a price given per `unit` (legacy Q Price = P.Price / C in Q). */
export function pricePerBaseUnit(cfg: ItemUnitConfig, unitPrice: Dec, unit?: string): Dec {
  return div(unitPrice, unitFactor(cfg, unit));
}

/**
 * Legacy conversion (parity checks and migration only): legacy base units = quantity x Box + loose
 * for every item (itmCr = CbQ * Box + Qty); the legacy screens displayed packs (= itmCr / Box) + loose.
 */
export function legacyBaseQuantity(qty: number, box: number, loose: number): Dec {
  return add(mul(dec(qty), dec(box)), dec(loose));
}
