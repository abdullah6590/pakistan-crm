// src/app/api/accounting/items/[id]/units/route.ts - Per-item units, pack sizes and reference cost (F-01, F-02).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { unitProfileSchema } from "@/lib/accounting/schemas";
import { accountingError } from "@/lib/accounting/server";
import { unitConfigFor } from "@/lib/accounting/posting";
import { assertUnitChangeAllowed, legacyFieldsFrom } from "@/lib/catalog/units";
import { validateUnitConfig, QuantityError } from "@/lib/domain/units";
import { dec, toPlain } from "@/lib/domain/decimal";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("inventory", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const item = await prisma.component.findUnique({ where: { id }, include: { unitProfile: { include: { conversions: true } } } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const { cfg, confirmed } = unitConfigFor(item);
  return NextResponse.json({ item: { id: item.id, name: item.name, sku: item.sku }, profile: item.unitProfile, effective: cfg, confirmed });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const data = unitProfileSchema.parse(await request.json());
    const cfg = {
      kind: data.kind, baseUnit: data.baseUnit, baseDecimals: data.baseDecimals,
      conversions: data.conversions.map((c) => ({ code: c.code, factor: String(c.factor), decimals: c.decimals ?? 0 })),
      purchaseUnit: data.purchaseUnit ?? undefined, saleUnit: data.saleUnit ?? undefined,
    };
    try {
      validateUnitConfig(cfg);
    } catch (e) {
      if (e instanceof QuantityError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
    const item = await prisma.component.findUnique({ where: { id }, include: { unitProfile: { include: { conversions: true } } } });
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    // Changing units after stock has moved would reinterpret recorded quantities: the kind, the stock unit and every
    // existing pack size are locked; an administrator may correct them with a written reason (P-2, audited below)
    const body = data as typeof data & { correctionReason?: string | null };
    const plain = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : toPlain(dec(v)));
    const fields = {
      kind: data.kind, baseUnit: data.baseUnit, baseDecimals: data.baseDecimals,
      purchaseUnit: data.purchaseUnit ?? null, saleUnit: data.saleUnit ?? null, confirmed: data.confirmed,
      referencePurchasePrice: plain(data.referencePurchasePrice), referenceExpenses: plain(data.referenceExpenses), updatedById: auth.user.id,
    };
    const profile = await prisma.$transaction(async (tx) => {
      const changes = await assertUnitChangeAllowed(tx, item, cfg, auth.user, body.correctionReason);
      const saved = await tx.itemUnitProfile.upsert({ where: { componentId: id }, create: { componentId: id, ...fields }, update: fields });
      await tx.itemUnitConversion.deleteMany({ where: { profileId: saved.id } });
      await tx.itemUnitConversion.createMany({ data: cfg.conversions.map((c) => ({ profileId: saved.id, code: c.code, factor: toPlain(dec(c.factor)), decimals: c.decimals })) });
      // The older product fields are copies of the profile, so older screens show the same packet size
      await tx.component.update({ where: { id }, data: legacyFieldsFrom(cfg) });
      await tx.auditLog.create({
        data: { entity: "ItemUnitProfile", entityId: id, action: changes.length && item.unitProfile ? "UNIT_CORRECTION" : "UPDATE", userId: auth.user.id, reason: changes.length ? body.correctionReason ?? null : null, before: item.unitProfile ? JSON.stringify(item.unitProfile) : null, after: JSON.stringify({ ...fields, conversions: cfg.conversions }) },
      });
      return tx.itemUnitProfile.findUniqueOrThrow({ where: { id: saved.id }, include: { conversions: true } });
    });
    return NextResponse.json({ profile });
  } catch (error) {
    return accountingError(error);
  }
}
