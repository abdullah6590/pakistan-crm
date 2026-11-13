// src/app/api/inventory/[id]/route.ts - Single component management
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { createStockAdjustment, fallbackUnitConfig, unitConfigFor } from "@/lib/accounting/posting";
import { assertUnitChangeAllowed, unitChangesAfterMovement, writeUnitProfile } from "@/lib/catalog/units";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";

/** Fields an item edit may change. The stock quantity is not one of them: it changes only through Books (sales,
 *  purchases, stock counts), and running totals belong to the system (Report 28, owner decision 2026-10-26). */
const EDITABLE = [
  "name", "sku", "description", "categoryId", "supplierId", "minQuantity", "packagingUnit", "itemsPerPackage",
  "supplierPrice", "expenses", "unitCost", "unitPrice", "isActive", "size", "grams", "unit", "location",
  "dimensionX", "dimensionY", "divisor", "gsm", "rimInSheet", "weightKg", "ratePerKg", "datasheetUrl", "imageUrl", "customFields",
];

/** Copies of the unit profile's packet size; never written directly. */
const PACK_FIELDS = ["unit", "rimInSheet", "itemsPerPackage", "packagingUnit"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize("inventory", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const component = await prisma.component.findUnique({
    where: { id },
    include: {
      category: true,
      supplier: true,
      inventoryHistory: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });
  return NextResponse.json({ component });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  const user = auth.user;
  if (user.role !== "ADMIN" && user.role !== "INVENTORY_MANAGER") {
    return NextResponse.json({ error: "Forbidden: Not authorized to modify inventory" }, { status: 403 });
  }

  const body = await request.json();
  const existing = await prisma.component.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Component not found" }, { status: 404 });

  try {
    // A different quantity is a stock count in Books: it waits for approval by someone other than the person who
    // entered it (D-2; the owner override needs a written reason) and then moves stock, cost and accounts together
    let stockCount: unknown = null;
    if (body.quantity !== undefined && body.quantity !== null && Number(body.quantity) !== existing.quantity) {
      const counted = Number(body.quantity);
      if (!Number.isFinite(counted) || counted < 0) return NextResponse.json({ error: "Enter the counted quantity (0 or more)" }, { status: 400 });
      const reason = String(body.countReason ?? "").trim();
      if (reason.length < 5) return NextResponse.json({ error: "A change of stock quantity is a stock count: give a reason (who counted, why)" }, { status: 400 });
      await accountingReady();
      const doc = await createStockAdjustment(prisma, { id: user.id, role: user.role }, {
        date: new Date(), lines: [{ componentId: id, quantity: counted }],
        remarks: `Counted on the Inventory screen: ${reason} (screen showed ${existing.quantity}, counted ${counted})`,
      }) as { id: string; docNo: string; status: string };
      stockCount = { id: doc.id, docNo: doc.docNo, status: doc.status };
    }

    // Packet size and stock unit live in the unit profile (Report 32 phase 1): a change made on this screen goes through
    // it, locked once stock has moved (an administrator may correct with a reason); the older fields are copies
    const packChange = Object.fromEntries(PACK_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
    if (Object.keys(packChange).length) {
      const item = await prisma.component.findUniqueOrThrow({ where: { id }, include: { unitProfile: { include: { conversions: true } } } });
      const next = fallbackUnitConfig({ ...item, ...packChange, unitProfile: null });
      const current = unitConfigFor(item).cfg;
      if (unitChangesAfterMovement(current, next).length) {
        await prisma.$transaction(async (tx) => {
          const changes = await assertUnitChangeAllowed(tx, item, next, user, body.correctionReason);
          await writeUnitProfile(tx, id, next, { confirmed: true, updatedById: user.id });
          await tx.auditLog.create({ data: { entity: "ItemUnitProfile", entityId: id, action: item.unitProfile ? "UNIT_CORRECTION" : "UPDATE", userId: user.id, reason: body.correctionReason ?? null, before: JSON.stringify(current), after: JSON.stringify({ ...next, changes }) } });
        });
      }
    }
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => EDITABLE.includes(k) && !PACK_FIELDS.includes(k)));
    const component = Object.keys(data).length
      ? await prisma.component.update({ where: { id }, data, include: { category: true, supplier: true } })
      : await prisma.component.findUniqueOrThrow({ where: { id }, include: { category: true, supplier: true } });

    return NextResponse.json(serialize({ success: true, component, stockCount }));
  } catch (error) {
    return accountingError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize("inventory", "delete");
  if (auth.response) return auth.response;
  const user = auth.user;

  try {
    const component = await prisma.component.findUnique({
      where: { id },
      include: {
        _count: { select: { saleItems: true, purchaseItems: true, projectComponents: true } }
      }
    });

    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    if (component._count.saleItems > 0 || component._count.purchaseItems > 0 || component._count.projectComponents > 0) {
      return NextResponse.json({ error: "Cannot delete component because it is used in sales, purchases, or projects." }, { status: 400 });
    }

    // Delete history first (Cascade)
    await prisma.inventoryHistory.deleteMany({ where: { componentId: id } });
    
    // Delete component
    await prisma.component.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete component error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete component" }, { status: 500 });
  }
}