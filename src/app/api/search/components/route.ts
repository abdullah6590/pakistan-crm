import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const rawLimit = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 20); // enforce max 20

    let components: any[];

    if (q.trim().length >= 2) {
      // Search mode
      components = await prisma.component.findMany({
        where: {
          isActive: true,
          OR: [
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
          dimensionX: true,
          dimensionY: true,
          gsm: true,
          divisor: true,
          weightKg: true,
          rimInSheet: true,
          ratePerKg: true,
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
          dimensionX: true,
          dimensionY: true,
          gsm: true,
          divisor: true,
          weightKg: true,
          rimInSheet: true,
          ratePerKg: true,
        },
      });
    }

    return NextResponse.json({ data: components });
  } catch (error) {
    console.error("Error searching components:", error);
    return NextResponse.json({ error: "Failed to search components" }, { status: 500 });
  }
}
