// src/lib/catalog/products.ts - Add New Product / edit product, as the old program's screen did it (Report 32 B.4),
// with the new rules: a short number from the counter, units in the item's unit profile (paper: packet = 100
// sheets by default), purchase and sale rate per kg kept apart, reorder level entered in packets, and opening stock
// posted through Books once, valued at the price per packet.
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PostingError, createOpeningStock, unitConfigFor } from "@/lib/accounting/posting";
import { weightPerPacket } from "@/lib/domain/pricing";
import { dec, roundHalfEven, toPlain } from "@/lib/domain/decimal";
import { isAuthority, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";
import { nextItemNo } from "./numbers";
import { PRODUCT_KINDS, assertUnitChangeAllowed, defaultUnitConfig, packUnitOf, writeUnitProfile } from "./units";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; role: string };

const money = z.coerce.number().min(0).max(1e9);
const optionalMoney = money.optional().nullable();
const count = z.coerce.number().int("Whole numbers only").min(0).max(1e9);

export const productSchema = z.object({
  name: z.string().trim().min(1, "Enter the product name").max(200),
  categoryId: z.string().min(1, "Choose a category"),
  kind: z.enum(PRODUCT_KINDS).default("PAPER"),
  /** Sheets per packet (paper) or pieces per pack (piece). Locked once stock has moved. */
  packSize: z.coerce.number().int("The packet size must be a whole number of sheets").min(1).max(100000).optional(),
  packCode: z.string().trim().max(20).optional(),
  dimensionX: optionalMoney,
  dimensionY: optionalMoney,
  gsm: optionalMoney,
  divisor: optionalMoney,
  /** Paper: rates per kg (old Sup-Price and Sale Price). */
  purchaseRatePerKg: optionalMoney,
  saleRatePerKg: optionalMoney,
  /** Non-paper: prices per pack (or per unit when there is no pack). */
  purchasePrice: optionalMoney,
  salePrice: optionalMoney,
  /** Opening stock: whole packets plus loose sheets (P-4). Only for a product with no stock yet. */
  openingPackets: count.optional(),
  openingLoose: count.optional(),
  /** Low-stock alert, in packets (or the base unit when there is no pack). */
  reorderLevel: count.optional(),
  supplierId: z.string().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  /** Administrator's reason to correct units after stock has moved (P-2). */
  correctionReason: z.string().max(500).optional().nullable(),
});
export type ProductInput = z.infer<typeof productSchema>;

/** Kg in one packet, or null when the paper size is incomplete. */
export function kgPerPacket(input: Pick<ProductInput, "dimensionX" | "dimensionY" | "gsm" | "divisor">, packSize: number): number | null {
  const [x, y, g] = [input.dimensionX, input.dimensionY, input.gsm].map((v) => Number(v) || 0);
  if (!(x > 0 && y > 0 && g > 0)) return null;
  return Number(toPlain(weightPerPacket({ x, y, gsm: g, divisor: Number(input.divisor) || 15500 }, packSize)));
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Books values stock to the paisa: the opening stock takes the packet price rounded half-to-even to 2 places. */
const toPaisaText = (n: number) => toPlain(roundHalfEven(dec(n), 2));

/** Prices per pack for the older price fields (unitCost, unitPrice): paper from kg x rate, others as typed. */
function packPrices(input: ProductInput, packSize: number) {
  if (input.kind === "PAPER") {
    const kg = kgPerPacket(input, packSize);
    return {
      kg,
      cost: kg !== null && input.purchaseRatePerKg ? round4(kg * input.purchaseRatePerKg) : 0,
      price: kg !== null && input.saleRatePerKg ? round4(kg * input.saleRatePerKg) : 0,
    };
  }
  return { kg: null, cost: input.purchasePrice ?? 0, price: input.salePrice ?? 0 };
}

function productData(input: ProductInput, packSize: number) {
  const { cost, price } = packPrices(input, packSize);
  const paper = input.kind === "PAPER";
  const kg100 = paper ? kgPerPacket(input, 100) : null;
  return {
    name: input.name,
    categoryId: input.categoryId,
    supplierId: input.supplierId || null,
    description: input.description ?? null,
    dimensionX: paper ? input.dimensionX ?? null : null,
    dimensionY: paper ? input.dimensionY ?? null : null,
    gsm: paper ? input.gsm ?? null : null,
    divisor: paper ? input.divisor || 15500 : 15500,
    weightKg: kg100,
    ratePerKg: paper ? input.purchaseRatePerKg ?? null : null,
    saleRatePerKg: paper ? input.saleRatePerKg ?? null : null,
    unitCost: cost,
    unitPrice: price,
    supplierPrice: paper ? input.purchaseRatePerKg ?? 0 : cost,
  };
}

async function uniqueSku(tx: Tx, itemNo: number): Promise<string> {
  const base = `P${String(itemNo).padStart(5, "0")}`;
  for (let i = 0; ; i++) {
    const sku = i ? `${base}-${i}` : base;
    if (!(await tx.component.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
}

/** Base units for a reorder level typed in packs. */
function reorderBase(level: number | undefined, packSize: number | null): number {
  return Math.max(0, Math.round((level ?? 0) * (packSize ?? 1)));
}

export async function createProduct(db: PrismaClient, actor: Actor, raw: unknown) {
  if (!isAuthority()) throw new PostingError(OFFLINE_ONLY_MESSAGE, 409);
  const input = productSchema.parse(raw);
  const cfg = defaultUnitConfig(input.kind, input.packSize, input.packCode);
  const pack = packUnitOf(cfg);
  const opening = (input.openingPackets ?? 0) * (pack?.factor ?? 1) + (input.openingLoose ?? 0);
  if ((input.openingLoose ?? 0) > 0 && pack && (input.openingLoose ?? 0) >= pack.factor) {
    throw new PostingError(`Loose ${cfg.baseUnit}s must be fewer than one ${pack.code} (${pack.factor}); enter whole ${pack.code}s instead`);
  }
  const data = productData(input, pack?.factor ?? 1);
  if (opening > 0 && !(data.unitCost > 0)) {
    throw new PostingError(input.kind === "PAPER"
      ? "Enter the purchase rate per kg (and the size) so the opening stock can be valued, or save with no opening stock"
      : "Enter the purchase price so the opening stock can be valued, or save with no opening stock");
  }
  if (input.kind === "SERVICE" && opening > 0) throw new PostingError("A service holds no stock");

  return db.$transaction(async (tx) => {
    const itemNo = await nextItemNo(tx);
    const created = await tx.component.create({
      data: { ...data, itemNo, sku: await uniqueSku(tx, itemNo), quantity: 0, minQuantity: reorderBase(input.reorderLevel, pack?.factor ?? 1) },
    });
    await writeUnitProfile(tx, created.id, cfg, {
      confirmed: true, updatedById: actor.id,
      referencePurchasePrice: input.kind === "PAPER" ? (input.purchaseRatePerKg ? toPlain(dec(input.purchaseRatePerKg)) : null) : (data.unitCost ? toPlain(dec(data.unitCost)) : null),
    });
    if (opening > 0) {
      await createOpeningStock(tx, actor, {
        date: new Date(),
        lines: [pack
          ? { componentId: created.id, quantity: input.openingPackets ?? 0, unit: pack.code, loose: input.openingLoose ?? 0, unitCost: toPaisaText(data.unitCost) }
          : { componentId: created.id, quantity: opening, unitCost: toPaisaText(data.unitCost) }],
        remarks: `Opening stock of new product ${itemNo} ${created.name}`,
      });
    } else {
      await tx.inventoryHistory.create({ data: { componentId: created.id, type: "ADD", quantity: 0, balanceAfter: 0, reference: `New product ${itemNo}`, performedBy: actor.id } });
    }
    await tx.auditLog.create({ data: { entity: "Component", entityId: created.id, action: "CREATE", userId: actor.id, after: JSON.stringify({ itemNo, ...input, correctionReason: undefined }) } });
    return tx.component.findUniqueOrThrow({ where: { id: created.id }, include: { category: true, unitProfile: { include: { conversions: true } }, _count: { select: { stockMovements: true } } } });
  }, { timeout: 60_000 });
}

export async function updateProduct(db: PrismaClient, actor: Actor, id: string, raw: unknown) {
  if (!isAuthority()) throw new PostingError(OFFLINE_ONLY_MESSAGE, 409);
  const input = productSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const item = await tx.component.findUnique({ where: { id }, include: { unitProfile: { include: { conversions: true } } } });
    if (!item) throw new PostingError("Product not found", 404);
    const { cfg: current } = unitConfigFor(item);
    // Kind and packet size come from the screen; a product whose kind is not one the screen offers keeps its units
    const offered = (PRODUCT_KINDS as readonly string[]).includes(current.kind);
    const next = offered ? defaultUnitConfig(input.kind, input.packSize, input.packCode ?? packUnitOf(current)?.code) : current;
    const changes = await assertUnitChangeAllowed(tx, item, next, actor, input.correctionReason);
    const pack = packUnitOf(next);
    if ((input.openingPackets ?? 0) > 0 || (input.openingLoose ?? 0) > 0) {
      throw new PostingError("Opening stock is entered once, when the product is added (or from Inventory → Opening stock). Correct stock later with a stock count.");
    }
    const data = productData({ ...input, kind: offered ? input.kind : (current.kind as ProductInput["kind"]) }, pack?.factor ?? 1);
    await tx.component.update({ where: { id }, data: { ...data, minQuantity: reorderBase(input.reorderLevel, pack?.factor ?? 1) } });
    const unitsChanged = changes.length > 0 || !item.unitProfile;
    const refPrice = input.kind === "PAPER" ? (input.purchaseRatePerKg ? toPlain(dec(input.purchaseRatePerKg)) : null) : (data.unitCost ? toPlain(dec(data.unitCost)) : null);
    if (unitsChanged) {
      await writeUnitProfile(tx, id, next, { confirmed: true, updatedById: actor.id, referencePurchasePrice: refPrice });
    } else if (item.unitProfile) {
      // Units unchanged: keep the reference cost in step with the purchase rate, and the older fields in step
      await tx.itemUnitProfile.update({ where: { id: item.unitProfile.id }, data: { referencePurchasePrice: refPrice, updatedById: actor.id } });
    }
    await tx.auditLog.create({
      data: {
        entity: "Component", entityId: id, action: changes.length && item.unitProfile ? "UNIT_CORRECTION" : "UPDATE", userId: actor.id,
        reason: changes.length ? input.correctionReason ?? null : null,
        before: JSON.stringify({ name: item.name, categoryId: item.categoryId, ratePerKg: item.ratePerKg, saleRatePerKg: item.saleRatePerKg, units: current }),
        after: JSON.stringify({ ...input, correctionReason: undefined, unitChanges: changes }),
      },
    });
    return tx.component.findUniqueOrThrow({ where: { id }, include: { category: true, unitProfile: { include: { conversions: true } }, _count: { select: { stockMovements: true } } } });
  }, { timeout: 60_000 });
}
