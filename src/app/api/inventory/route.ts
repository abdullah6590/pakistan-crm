// src/app/api/inventory/route.ts - Inventory management API
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { componentSchema } from "@/lib/validations";
import { generateSKU } from "@/lib/utils";
import { createOpeningStock, unitConfigFor } from "@/lib/accounting/posting";
import { accountingError, accountingReady } from "@/lib/accounting/server";

export async function GET(request: NextRequest) {
  const auth = await authorize("inventory", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const categoryId = searchParams.get("categoryId");
  const lowStock = searchParams.get("lowStock") === "true";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const skip = (page - 1) * limit;

  const components = await prisma.component.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } },
          ],
        } : {},
        categoryId ? { categoryId } : {},
        lowStock ? { quantity: { lte: prisma.component.fields.minQuantity } } : {},
      ],
    },
    include: { category: true, supplier: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    skip,
    take: limit,
  });

  const totalRecords = await prisma.component.count({
    where: {
      AND: [
        search ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } },
          ],
        } : {},
        categoryId ? { categoryId } : {},
        lowStock ? { quantity: { lte: prisma.component.fields.minQuantity } } : {},
      ],
    },
  });

  // Summary stats
  const totalItems = await prisma.component.aggregate({ _sum: { quantity: true } });
  const totalValue = await prisma.component.aggregate({ _sum: { quantity: true } });
  const lowStockCount = await prisma.component.count({ where: { quantity: { lte: prisma.component.fields.minQuantity } } });

  return NextResponse.json({
    components,
    pagination: {
      total: totalRecords,
      pages: Math.ceil(totalRecords / limit),
      page,
      limit,
    },
    stats: {
      totalItems: totalItems._sum.quantity || 0,
      totalComponents: totalRecords,
      lowStock: lowStockCount,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  const user = auth.user;

  try {
    const body = await request.json();
    const parsed = componentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const sku = body.sku || generateSKU(body.category || "GEN", Date.now() % 100000);

    // A starting quantity is opening stock in Books (Report 28 §6): stock and its cost enter the books once, and the
    // item's count follows from that posting. The item and its opening stock are saved together or not at all.
    await accountingReady();
    const startQty = Math.max(0, parsed.data.quantity ?? 0);
    // Opening stock is valued at what it cost; with no cost the item is saved without stock, and its opening stock is
    // entered later from Inventory → Opening stock once the cost is known (owner instruction 2026-10-26)
    if (startQty > 0 && !(parsed.data.unitCost > 0)) {
      return NextResponse.json({ error: "Enter the purchase cost for the starting quantity, or save the item with quantity 0 and enter its opening stock later (Inventory → Opening stock)" }, { status: 400 });
    }
    const component = await prisma.$transaction(async (tx) => {
      const created = await tx.component.create({ data: { ...parsed.data, sku, quantity: 0 } });
      if (startQty > 0) {
        // The cost is per package when the item comes in packages (as the Total Amount on the form shows it)
        const { cfg } = unitConfigFor({ ...created, unitProfile: null });
        const perPack = created.itemsPerPackage > 1 ? created.itemsPerPackage : 1;
        const pack = perPack > 1 ? (cfg.conversions ?? []).find((u) => Number(u.factor) === perPack) : undefined;
        if (perPack > 1 && !pack) throw new Error("This item's package size does not match its stock unit: save it with quantity 0 and enter its opening stock from Inventory → Opening stock, where you choose the unit");
        await createOpeningStock(tx, { id: user.id, role: user.role }, {
          date: new Date(),
          lines: [pack
            ? { componentId: created.id, quantity: Math.floor(startQty / perPack), unit: pack.code, loose: startQty % perPack, unitCost: created.unitCost }
            : { componentId: created.id, quantity: startQty, unitCost: created.unitCost }],
          remarks: `Opening stock of new item ${created.name}`,
        });
      } else {
        await tx.inventoryHistory.create({
          data: { componentId: created.id, type: "ADD", quantity: 0, balanceAfter: 0, reference: `New item - ${created.sku}`, performedBy: user.id },
        });
      }
      return tx.component.findUniqueOrThrow({ where: { id: created.id }, include: { category: true, supplier: true } });
    }, { timeout: 60_000 });

    return NextResponse.json({ success: true, component }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("This item's package size")) return NextResponse.json({ error: error.message }, { status: 400 });
    return accountingError(error);
  }
}