import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { parseShortNo } from "@/lib/catalog/numbers";
import { accountingReady } from "@/lib/accounting/server";

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize("suppliers", "read");
    if (auth.response) return auth.response;
    const user = auth.user;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const rawLimit = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 20); // enforce max 20

    let suppliers: any[];

    // A typed party number (the old program's id) finds that party, even a single digit (Report 32 phase 1)
    await accountingReady();
    const no = parseShortNo(q);
    if (q.trim().length >= 2 || no) {
      suppliers = await prisma.supplier.findMany({
        where: {
          isActive: true,
          OR: [
            ...(no ? [{ partyNo: no }] : []),
            { name: { contains: q } },
            { phone: { contains: q } },
          ],
        },
        take: limit,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          phone: true,
          partyNo: true,
        },
      });
    } else if (q.trim().length > 0) {
       suppliers = [];
    } else {
      suppliers = await prisma.supplier.findMany({
        where: { isActive: true },
        take: limit,
        orderBy: { updatedAt: "desc" }, // Recent suppliers
        select: {
          id: true,
          name: true,
          phone: true,
          partyNo: true,
        },
      });
    }

    if (no) suppliers.sort((a, b) => Number(b.partyNo === no) - Number(a.partyNo === no));
    return NextResponse.json({ data: suppliers });
  } catch (error) {
    console.error("Error searching suppliers:", error);
    return NextResponse.json({ error: "Failed to search suppliers" }, { status: 500 });
  }
}
