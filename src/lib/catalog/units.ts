// src/lib/catalog/units.ts - The item unit profile is the one place an item's units and packet size are kept
// (Report 32 G.3, owner approval 2026-11-13). The older product fields (unit, rimInSheet, packagingUnit,
// itemsPerPackage) are only copies, written from the profile so older screens show the same packet size.
import type { Prisma } from "@prisma/client";
import { DEFAULT_UNITS, ItemKind, ItemUnitConfig, QuantityError, validateUnitConfig } from "@/lib/domain/units";
import { dec, toPlain } from "@/lib/domain/decimal";
import { PostingError, unitConfigFor, type UnitSource } from "@/lib/accounting/posting";

type Tx = Prisma.TransactionClient;

/** Kinds a product can be created as. Paper is the default: packet = 100 sheets (owner rule, P-1 option B). */
export const PRODUCT_KINDS = ["PAPER", "PIECE", "WEIGHT", "SERVICE"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const DEFAULT_PACKET_SHEETS = 100;

/**
 * A new product's units. Paper: stock in sheets, bought and sold in packets of `packSize` sheets (default 100;
 * other sizes such as 200 or 250 are allowed, P-2). Piece: an optional pack (carton, box) of `packSize` pieces.
 * Weight: kg with 3 decimals. Service: no stock (Labour).
 */
export function defaultUnitConfig(kind: ProductKind = "PAPER", packSize?: number, packCode?: string): ItemUnitConfig {
  if (kind === "PAPER") {
    const size = packSize && packSize > 0 ? packSize : DEFAULT_PACKET_SHEETS;
    return { ...DEFAULT_UNITS.PAPER, conversions: [{ code: "packet", factor: size, decimals: 0 }], purchaseUnit: "packet", saleUnit: "packet" };
  }
  if (kind === "PIECE") {
    const code = (packCode || "carton").trim().toLowerCase();
    if (packSize && packSize > 1) return { ...DEFAULT_UNITS.PIECE, conversions: [{ code, factor: packSize, decimals: 0 }], purchaseUnit: code, saleUnit: code };
    return { ...DEFAULT_UNITS.PIECE };
  }
  return { ...DEFAULT_UNITS[kind as ItemKind] };
}

/** The pack unit an item is normally counted in (packet for paper), or null when it has none. */
export function packUnitOf(cfg: ItemUnitConfig): { code: string; factor: number } | null {
  const code = cfg.saleUnit && cfg.saleUnit !== cfg.baseUnit ? cfg.saleUnit : cfg.conversions?.[0]?.code;
  const c = (cfg.conversions ?? []).find((x) => x.code === code);
  return c ? { code: c.code, factor: Number(c.factor) } : null;
}

/** The older product fields, as copies of the profile (so they can never disagree with it). */
export function legacyFieldsFrom(cfg: ItemUnitConfig): { unit: string; rimInSheet: number | null; packagingUnit: string; itemsPerPackage: number } {
  const pack = packUnitOf(cfg);
  const whole = pack && Number.isInteger(pack.factor) ? pack.factor : 1;
  return {
    unit: cfg.baseUnit,
    rimInSheet: cfg.kind === "PAPER" ? whole : null,
    packagingUnit: pack ? pack.code.charAt(0).toUpperCase() + pack.code.slice(1) : "Piece",
    itemsPerPackage: whole,
  };
}

/** Profile row fields for a unit config (the conversions are written separately). */
export function profileFields(cfg: ItemUnitConfig, extra: { confirmed?: boolean; referencePurchasePrice?: string | null; updatedById?: string | null } = {}) {
  return {
    kind: cfg.kind,
    baseUnit: cfg.baseUnit,
    baseDecimals: cfg.baseDecimals ?? 0,
    purchaseUnit: cfg.purchaseUnit ?? null,
    saleUnit: cfg.saleUnit ?? null,
    confirmed: extra.confirmed ?? true,
    ...(extra.referencePurchasePrice !== undefined ? { referencePurchasePrice: extra.referencePurchasePrice } : {}),
    ...(extra.updatedById !== undefined ? { updatedById: extra.updatedById } : {}),
  };
}

/** Create or replace an item's profile and copy the packet size to the older product fields, in one transaction. */
export async function writeUnitProfile(
  tx: Tx, componentId: string, cfg: ItemUnitConfig,
  extra: { confirmed?: boolean; referencePurchasePrice?: string | null; updatedById?: string | null } = {},
) {
  try {
    validateUnitConfig(cfg);
  } catch (e) {
    if (e instanceof QuantityError) throw new PostingError(e.message, 400);
    throw e;
  }
  const fields = profileFields(cfg, extra);
  const saved = await tx.itemUnitProfile.upsert({ where: { componentId }, create: { componentId, ...fields }, update: fields });
  await tx.itemUnitConversion.deleteMany({ where: { profileId: saved.id } });
  if (cfg.conversions?.length) {
    await tx.itemUnitConversion.createMany({
      data: cfg.conversions.map((c) => ({ profileId: saved.id, code: c.code, factor: toPlain(dec(c.factor)), decimals: c.decimals ?? 0 })),
    });
  }
  await tx.component.update({ where: { id: componentId }, data: legacyFieldsFrom(cfg) });
  return tx.itemUnitProfile.findUniqueOrThrow({ where: { id: saved.id }, include: { conversions: true } });
}

/** Pack sizes by unit code, for comparing two configs. */
function factors(cfg: ItemUnitConfig): Map<string, string> {
  return new Map((cfg.conversions ?? []).map((c) => [c.code, toPlain(dec(c.factor))]));
}

/** What would change in recorded quantities: the kind, the stock unit, or the size of an existing pack unit. */
export function unitChangesAfterMovement(before: ItemUnitConfig, after: ItemUnitConfig): string[] {
  const out: string[] = [];
  if (before.kind !== after.kind) out.push(`kind ${before.kind} → ${after.kind}`);
  if (before.baseUnit !== after.baseUnit) out.push(`stock unit ${before.baseUnit} → ${after.baseUnit}`);
  const a = factors(after);
  for (const [code, f] of factors(before)) {
    if (!a.has(code)) out.push(`${code} removed`);
    else if (a.get(code) !== f) out.push(`${code} size ${f} → ${a.get(code)}`);
  }
  return out;
}

/**
 * Packet size is locked once stock has moved (P-2): changing it would make the same recorded packets mean a
 * different number of sheets. Only an administrator may correct it, with a written reason, and the correction is
 * audited by the caller. Returns the list of changes (empty when nothing locked changes).
 */
export async function assertUnitChangeAllowed(
  tx: Tx, item: UnitSource & { id: string }, next: ItemUnitConfig,
  actor: { role: string }, correctionReason?: string | null,
): Promise<string[]> {
  const { cfg: current } = unitConfigFor(item);
  const changes = unitChangesAfterMovement(current, next);
  if (!changes.length) return changes;
  const moved = await tx.stockMovement.count({ where: { componentId: item.id } });
  if (moved === 0) return changes;
  const reason = (correctionReason ?? "").trim();
  if (actor.role !== "ADMIN" || reason.length < 10) {
    throw new PostingError(
      `Stock of this product has already moved, so its units are locked (${changes.join(", ")}). ` +
      "An administrator can correct them with a written reason of at least 10 characters.", 409);
  }
  return changes;
}
