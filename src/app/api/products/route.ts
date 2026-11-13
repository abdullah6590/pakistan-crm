// src/app/api/products/route.ts - Add New Product screen (Report 32 phase 1): the product list beside the form, found
// by number or name, and creating a product with its number, units, rates, reorder level and opening stock.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { createProduct } from "@/lib/catalog/products";
import { productRow, PRODUCT_ROW_FIELDS } from "@/lib/catalog/rows";
import { parseShortNo } from "@/lib/catalog/numbers";

export async function GET(request: NextRequest) {
  const auth = await authorize("inventory", "read");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    const no = parseShortNo(q);
    const rows = await prisma.component.findMany({
      where: { isActive: true, ...(q ? { OR: [...(no ? [{ itemNo: no }] : []), { name: { startsWith: q } }, { name: { contains: q } }, { sku: { contains: q } }] } : {}) },
      orderBy: [{ name: "asc" }],
      take: 300,
      select: PRODUCT_ROW_FIELDS,
    });
    // The typed number first, then names that start with the text (the old screen's search), then the rest
    const lower = q.toLowerCase();
    const rank = (r: { itemNo: number | null; name: string }) => (no && r.itemNo === no ? 0 : r.name.toLowerCase().startsWith(lower) ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b));
    return NextResponse.json(serialize({ products: rows.map(productRow) }));
  } catch (error) {
    return accountingError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const product = await createProduct(prisma, { id: auth.user.id, role: auth.user.role }, await request.json());
    return NextResponse.json(serialize({ product: productRow(product) }), { status: 201 });
  } catch (error) {
    return accountingError(error);
  }
}
