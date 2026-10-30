// src/lib/accounting/opening-stock.ts - Stock already on hand entered into Books once per item, at a cost the owner
// confirms (Report 28 §6; owner instruction 2026-10-26: never at zero or an invented cost, never twice).
import { dec, toPlain } from "@/lib/domain/decimal";
import { Actor, PostingError, Tx, createOpeningStock, run, unitConfigFor } from "./posting";
import { Db, MAIN_LOCATION } from "./setup";

export interface OpeningStockLine {
  componentId: string;
  /** Quantity on hand in `unit`, plus `loose` stock units with a pack unit. */
  quantity: number | string;
  unit?: string;
  loose?: number | string;
  /** What one `unit` cost; must be more than zero. */
  unitCost: number | string;
}

/** Stock movements or a main-store balance mean the item's stock is already in Books. */
async function inBooks(tx: Tx | Db, componentId: string, mainId: string) {
  const moved = await tx.stockMovement.count({ where: { componentId } });
  if (moved > 0) return true;
  const balance = await tx.itemStockBalance.findUnique({ where: { componentId_locationId: { componentId, locationId: mainId } } });
  return !!balance && Number(balance.onHand) !== 0;
}

/** Active items whose stock has not entered Books yet, with their units and the count shown on the Inventory screen. */
export async function openingStockCandidates(db: Db) {
  const main = await db.stockLocation.findUniqueOrThrow({ where: { code: MAIN_LOCATION } });
  const items = await db.component.findMany({
    where: { isActive: true }, orderBy: { name: "asc" },
    include: { unitProfile: { include: { conversions: true } }, category: { select: { name: true } } },
  });
  const out = [];
  for (const c of items) {
    if (await inBooks(db, c.id, main.id)) continue;
    const { cfg, confirmed } = unitConfigFor(c);
    out.push({
      id: c.id, sku: c.sku, name: c.name, category: c.category?.name ?? "", screenCount: c.quantity,
      baseUnit: cfg.baseUnit, baseDecimals: cfg.baseDecimals ?? 0,
      units: [...(cfg.conversions ?? []).map((u) => ({ code: u.code, factor: toPlain(dec(u.factor)) })), { code: cfg.baseUnit, factor: "1" }],
      purchaseUnit: cfg.purchaseUnit ?? null, unitsConfirmed: confirmed,
      /** The cost price on the item, only as a hint; it is never posted without the owner entering it. */
      costHint: c.unitCost > 0 ? c.unitCost : null,
    });
  }
  return out;
}

/**
 * Post the opening stock of the given items as one Books document. Each item may be entered once: an item whose stock is
 * already in Books (including by a second click or a second screen) is refused and nothing is posted. The Inventory
 * count of each item becomes the entered quantity; the earlier count is kept in the item history.
 */
export async function postOpeningStock(db: Db, actor: Actor, input: { date?: string; lines: OpeningStockLine[]; remarks?: string; requestId?: string }) {
  if (!input.lines.length) throw new PostingError("Choose at least one item");
  try {
    return await run(db, async (tx) => {
      if (input.requestId) {
        const again = await tx.accountingDocument.findUnique({ where: { commandId: input.requestId } });
        if (again) return { document: again, repeated: true };
      }
      const main = await tx.stockLocation.findUniqueOrThrow({ where: { code: MAIN_LOCATION } });
      for (const l of input.lines) {
        const c = await tx.component.findUnique({ where: { id: l.componentId } });
        if (!c) throw new PostingError("Item not found", 404);
        if (await inBooks(tx, c.id, main.id)) throw new PostingError(`${c.name}: its stock is already in Books (opening stock is entered once; use a stock count to correct it)`, 409);
        if (c.quantity !== 0) {
          await tx.component.update({ where: { id: c.id }, data: { quantity: 0 } });
          await tx.inventoryHistory.create({
            data: { componentId: c.id, type: "ADJUST", quantity: c.quantity, balanceAfter: 0, reference: `Count of ${c.quantity} before opening stock (replaced by the opening stock entered next)`, performedBy: actor.id },
          });
        }
      }
      const document = await createOpeningStock(tx, actor, {
        date: input.date ?? new Date().toISOString().slice(0, 10),
        lines: input.lines.map((l) => ({ componentId: l.componentId, quantity: l.quantity, unit: l.unit, loose: l.loose, unitCost: l.unitCost })),
        remarks: input.remarks?.trim() || "Opening stock",
      }) as { id: string };
      const saved = input.requestId
        ? await tx.accountingDocument.update({ where: { id: document.id }, data: { commandId: input.requestId } })
        : await tx.accountingDocument.findUniqueOrThrow({ where: { id: document.id } });
      return { document: saved, repeated: false };
    });
  } catch (e) {
    // Two identical submits at the same moment: the unique command id turned the second away; answer with the first
    if (input.requestId && /UNIQUE constraint failed|P2002/i.test(`${(e as { code?: string }).code} ${(e as Error).message}`)) {
      const first = await db.accountingDocument.findUnique({ where: { commandId: input.requestId } });
      if (first) return { document: first, repeated: true };
    }
    throw e;
  }
}
