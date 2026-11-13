// src/lib/catalog/ensure.ts - One-time catch-up on the main server after the phase 1 migration: every product gets
// a unit profile (the same units it already behaved with) and every product and party without a number gets one,
// in the order they were created. Safe to run again: it only touches rows that are still missing something.
import type { PrismaClient } from "@prisma/client";
import { fallbackUnitConfig, unitConfigFor } from "@/lib/accounting/posting";
import { legacyFieldsFrom, profileFields } from "./units";
import { ITEM_SERIES, PARTY_SERIES } from "./numbers";
import { dec, toPlain } from "@/lib/domain/decimal";

export interface CatalogCatchUp { profiles: number; resynced: number; itemNos: number; partyNos: number }

/** The counter's next value, never below the highest number already given (a restored or imported database). */
async function counterStart(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], series: string, highest: number) {
  const row = await tx.documentSeries.findUnique({ where: { series } });
  return Math.max(row?.nextNumber ?? 1, highest + 1);
}

export async function ensureCatalog(db: PrismaClient, userId?: string): Promise<CatalogCatchUp> {
  return db.$transaction(async (tx) => {
    // 1. Unit profiles: exactly the units the item was already using (fallback), marked unconfirmed as before, so
    //    no recorded quantity or price changes meaning
    const bare = await tx.component.findMany({
      where: { unitProfile: null },
      select: { id: true, unit: true, rimInSheet: true, itemsPerPackage: true, packagingUnit: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const c of bare) {
      const cfg = fallbackUnitConfig({ ...c, unitProfile: null });
      const saved = await tx.itemUnitProfile.create({ data: { componentId: c.id, ...profileFields(cfg, { confirmed: false }) } });
      if (cfg.conversions?.length) {
        await tx.itemUnitConversion.createMany({
          data: cfg.conversions.map((u) => ({ profileId: saved.id, code: u.code, factor: toPlain(dec(u.factor)), decimals: u.decimals ?? 0 })),
        });
      }
    }

    // 1b. The older pack fields are copies of the profile: bring any that disagree in line (an item set up on Books →
    //     Settings → Item units before this change could still show its old packet size on the Inventory screen)
    const withProfile = await tx.component.findMany({
      where: { unitProfile: { isNot: null } },
      select: { id: true, unit: true, rimInSheet: true, itemsPerPackage: true, packagingUnit: true, unitProfile: { include: { conversions: true } } },
    });
    let resynced = 0;
    for (const c of withProfile) {
      const want = legacyFieldsFrom(unitConfigFor(c).cfg);
      if (want.unit !== c.unit || want.rimInSheet !== c.rimInSheet || want.itemsPerPackage !== c.itemsPerPackage || want.packagingUnit !== c.packagingUnit) {
        await tx.component.update({ where: { id: c.id }, data: want });
        resynced++;
      }
    }

    // 2. Product numbers in creation order
    const items = await tx.component.findMany({ where: { itemNo: null }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (items.length) {
      const top = await tx.component.aggregate({ _max: { itemNo: true } });
      let n = await counterStart(tx, ITEM_SERIES, top._max.itemNo ?? 0);
      for (const it of items) await tx.component.update({ where: { id: it.id }, data: { itemNo: n++ } });
      await tx.documentSeries.upsert({ where: { series: ITEM_SERIES }, create: { series: ITEM_SERIES, nextNumber: n }, update: { nextNumber: n } });
    }

    // 3. Party numbers: customers and suppliers together, in creation order (one sequence, like the old SubCode)
    const [cus, sup] = await Promise.all([
      tx.customer.findMany({ where: { partyNo: null }, select: { id: true, createdAt: true } }),
      tx.supplier.findMany({ where: { partyNo: null }, select: { id: true, createdAt: true } }),
    ]);
    const parties = [...cus.map((c) => ({ ...c, kind: "customer" as const })), ...sup.map((s) => ({ ...s, kind: "supplier" as const }))]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "supplier" ? -1 : 1));
    if (parties.length) {
      const [tc, ts] = await Promise.all([tx.customer.aggregate({ _max: { partyNo: true } }), tx.supplier.aggregate({ _max: { partyNo: true } })]);
      let n = await counterStart(tx, PARTY_SERIES, Math.max(tc._max.partyNo ?? 0, ts._max.partyNo ?? 0));
      for (const p of parties) {
        if (p.kind === "customer") await tx.customer.update({ where: { id: p.id }, data: { partyNo: n++ } });
        else await tx.supplier.update({ where: { id: p.id }, data: { partyNo: n++ } });
      }
      await tx.documentSeries.upsert({ where: { series: PARTY_SERIES }, create: { series: PARTY_SERIES, nextNumber: n }, update: { nextNumber: n } });
    }

    const result = { profiles: bare.length, resynced, itemNos: items.length, partyNos: parties.length };
    if (result.profiles || result.resynced || result.itemNos || result.partyNos) {
      await tx.auditLog.create({
        data: { entity: "Catalog", entityId: "phase1", action: "BACKFILL", userId: userId ?? "system", reason: "Unit profiles and short numbers for existing rows (Report 32 phase 1)", after: JSON.stringify(result) },
      });
    }
    return result;
  }, { timeout: 120_000 });
}
