import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import { SPEC_FIELDS } from "@/lib/product-spec";
import { parseShortNo } from "@/lib/catalog/numbers";
import { accountingReady } from "@/lib/accounting/server";

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize("inventory", "read");
    if (auth.response) return auth.response;
    const user = auth.user;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const rawLimit = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 20); // enforce max 20

    let components: any[];

    // Numbers exist once the main server has caught up (Report 32 phase 1)
    await accountingReady();
    // A typed product number (the old program's ID) finds that product, even a single digit
    const no = parseShortNo(q);
    if (q.trim().length >= 2 || no) {
      // Search mode
      components = await prisma.component.findMany({
        where: {
          isActive: true,
          OR: [
            ...(no ? [{ itemNo: no }] : []),
            { name: { contains: q } },
            { sku: { contains: q } },
          ],
        },
        take: limit,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          sku: true,
          quantity: true,
          unitCost: true,
          unitPrice: true,
          minQuantity: true,
          ...SPEC_FIELDS,
          ...UNIT_FIELDS,
        },
      });
    } else if (q.trim().length > 0) {
       // Search string too short, return empty instead of scanning
       components = [];
    } else {
      // Default/Recent mode
      components = await prisma.component.findMany({
        where: { isActive: true },
        take: limit,
        orderBy: { totalSold: "desc" }, // Most popular
        select: {
          id: true,
          name: true,
          sku: true,
          quantity: true,
          unitCost: true,
          unitPrice: true,
          minQuantity: true,
          ...SPEC_FIELDS,
          ...UNIT_FIELDS,
        },
      });
    }

    // The product with the typed number comes first
    if (no) components.sort((a, b) => Number(b.itemNo === no) - Number(a.itemNo === no));
    return NextResponse.json({ data: components.map(withSaleUnits) });
  } catch (error) {
    console.error("Error searching components:", error);
    return NextResponse.json({ error: "Failed to search components" }, { status: 500 });
  }
}
