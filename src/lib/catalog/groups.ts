// src/lib/catalog/groups.ts - Item Group price per kg (old PG.Pprice, Report 32 B.3). Choosing the group on a new
// product fills its purchase rate; changing the price can update the purchase rate of the group's products, but only
// after the user has seen how many will change and confirmed that number. Bills keep their own prices.
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PostingError, unitConfigFor } from "@/lib/accounting/posting";
import { dec, toPlain } from "@/lib/domain/decimal";
import { isAuthority, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";
import { kgPerPacket } from "./products";
import { packUnitOf } from "./units";

export const groupPriceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  ratePerKg: z.coerce.number().min(0).max(1e9).nullable(),
  /** Also set this rate as the purchase rate of the group's products. */
  updateProducts: z.boolean().default(false),
  /** The number of products the user was shown and agreed to; refused if it no longer matches. */
  confirmCount: z.coerce.number().int().min(0).optional(),
});

const inGroup = (categoryId: string) => ({ categoryId, isActive: true });

export async function groupPriceImpact(db: PrismaClient, categoryId: string) {
  const group = await db.componentCategory.findUnique({ where: { id: categoryId } });
  if (!group) throw new PostingError("Item group not found", 404);
  const products = await db.component.count({ where: inGroup(categoryId) });
  return { group: { id: group.id, name: group.name, ratePerKg: group.ratePerKg }, products };
}

export async function setGroupPrice(db: PrismaClient, actor: { id: string; role: string }, categoryId: string, raw: unknown) {
  if (!isAuthority()) throw new PostingError(OFFLINE_ONLY_MESSAGE, 409);
  const input = groupPriceSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const group = await tx.componentCategory.findUnique({ where: { id: categoryId } });
    if (!group) throw new PostingError("Item group not found", 404);
    if (input.name && input.name !== group.name && (await tx.componentCategory.findUnique({ where: { name: input.name } }))) {
      throw new PostingError(`A group called "${input.name}" already exists`, 409);
    }
    const products = await tx.component.findMany({ where: inGroup(categoryId), include: { unitProfile: { include: { conversions: true } } } });
    if (input.updateProducts) {
      if (input.ratePerKg === null) throw new PostingError("Enter the price per kg to set on the products");
      if (input.confirmCount !== products.length) {
        throw new PostingError(`The group now has ${products.length} products (you confirmed ${input.confirmCount ?? 0}); check again and confirm`, 409);
      }
    }
    await tx.componentCategory.update({ where: { id: categoryId }, data: { ...(input.name ? { name: input.name } : {}), ratePerKg: input.ratePerKg } });
    let updated = 0;
    if (input.updateProducts && input.ratePerKg !== null) {
      const rate = input.ratePerKg;
      for (const p of products) {
        const { cfg } = unitConfigFor(p);
        const pack = packUnitOf(cfg);
        const kg = cfg.kind === "PAPER" ? kgPerPacket(p, pack?.factor ?? 100) : null;
        await tx.component.update({
          where: { id: p.id },
          data: { ratePerKg: rate, supplierPrice: rate, ...(kg !== null ? { unitCost: Math.round(kg * rate * 10000) / 10000 } : {}) },
        });
        if (p.unitProfile && cfg.kind === "PAPER") {
          await tx.itemUnitProfile.update({ where: { id: p.unitProfile.id }, data: { referencePurchasePrice: toPlain(dec(rate)), updatedById: actor.id } });
        }
        updated++;
      }
    }
    await tx.auditLog.create({
      data: {
        entity: "ComponentCategory", entityId: categoryId, action: "UPDATE", userId: actor.id,
        before: JSON.stringify({ name: group.name, ratePerKg: group.ratePerKg }),
        after: JSON.stringify({ name: input.name ?? group.name, ratePerKg: input.ratePerKg, productsUpdated: updated }),
      },
    });
    return { group: await tx.componentCategory.findUniqueOrThrow({ where: { id: categoryId } }), productsUpdated: updated };
  }, { timeout: 60_000 });
}
