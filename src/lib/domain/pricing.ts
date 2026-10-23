// src/lib/domain/pricing.ts - Paper weight and line pricing (Report 09 BR-01/04/05; owner decision OD-02).
import { Dec, dec, add, mul, div, ZERO } from "./decimal";
import { ItemUnitConfig, QuantityEntry, toBaseQuantity, pricePerBaseUnit } from "./units";

export const LEGACY_DIVISOR = 15500;

export interface PaperDimensions {
  /** Length in inches */
  x: number;
  /** Width in inches */
  y: number;
  gsm: number;
  /** Legacy itm.itmdv; 15500 = 100 sheets x 0.00064516 m2/in2 / 1000 g/kg */
  divisor?: number;
}

/** BR-01: weight in kg of 100 sheets = X * Y * GSM / divisor (legacy itm.itmKg). */
export function weightPer100Sheets(d: PaperDimensions): Dec {
  const divisor = d.divisor ?? LEGACY_DIVISOR;
  if (!(d.x > 0) || !(d.y > 0) || !(d.gsm > 0) || !(divisor > 0)) return ZERO;
  return div(mul(mul(dec(d.x), dec(d.y)), dec(d.gsm)), dec(divisor));
}

/**
 * OD-02 (approved change): weight of one packet reflects its real sheet count.
 * Legacy priced every packet as 100 sheets regardless of its size; see legacyPacketWeight.
 */
export function weightPerPacket(d: PaperDimensions, packSize: number): Dec {
  return div(mul(weightPer100Sheets(d), dec(packSize)), dec(100));
}

/** Legacy behaviour, kept for parity checks and for describing historical documents. */
export function legacyPacketWeight(d: PaperDimensions): Dec {
  return weightPer100Sheets(d);
}

/** BR-04: packet price from a rate per kg (unrounded, as the legacy client stored it). */
export function packetPriceFromRate(ratePerKg: number | string, packetWeightKg: Dec): Dec {
  return mul(dec(ratePerKg), packetWeightKg);
}

export interface LineInput {
  unit: ItemUnitConfig;
  quantity: QuantityEntry;
  /** Price per unit of `quantity.unit` (per packet, carton, kg, piece...; the base unit when no unit is given). */
  unitPrice: number | string | Dec;
}

export interface LinePricing {
  /** Quantity in the item's base unit (sheets, pieces, kg, service). */
  baseQuantity: Dec;
  unitPrice: Dec;
  /** Price per base unit = unit price / units per pack (legacy "Q Price", BR-05); equals unitPrice for the base unit. */
  loosePrice: Dec;
  /** Exact line amount, not rounded (BR-05/BR-07). */
  amount: Dec;
}

function asDec(v: number | string | Dec): Dec {
  return typeof v === "bigint" ? v : dec(v);
}

/** BR-05 for every item kind (F-01): amount = unit price x quantity + price per base unit x loose units. */
export function priceLine(input: LineInput): LinePricing {
  const baseQuantity = toBaseQuantity(input.unit, input.quantity);
  const unitPrice = asDec(input.unitPrice);
  if (unitPrice < ZERO) throw new Error("Prices cannot be negative");
  const loosePrice = pricePerBaseUnit(input.unit, unitPrice, input.quantity.unit);
  const quantity = dec(input.quantity.quantity);
  const loose = input.quantity.loose === undefined || input.quantity.loose === "" ? ZERO : dec(input.quantity.loose);
  return { baseQuantity, unitPrice, loosePrice, amount: add(mul(unitPrice, quantity), mul(loosePrice, loose)) };
}

/** Legacy line amount exactly as the database computed it: NetAm = Pprice*CbQ + (Pprice/Box)*Qty. */
export function legacyLineAmount(pprice: number, cbq: number, box: number, qty: number): Dec {
  const unit = dec(pprice);
  return add(mul(unit, dec(cbq)), mul(div(unit, dec(box)), dec(qty)));
}
