import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { parseShortNo } from "@/lib/catalog/numbers";
import { accountingReady } from "@/lib/accounting/server";

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize("customers", "read");
    if (auth.response) return auth.response;
    const user = auth.user;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const rawLimit = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 20); // enforce max 20

    let customers: any[];

    // A typed party number (the old program's id) finds that party, even a single digit (Report 32 phase 1)
    await accountingReady();
    const no = parseShortNo(q);
    if (q.trim().length >= 2 || no) {
      customers = await prisma.customer.findMany({
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
       customers = [];
    } else {
      customers = await prisma.customer.findMany({
        where: { isActive: true },
        take: limit,
        orderBy: { visitCount: "desc" }, // Most frequent customers
        select: {
          id: true,
          name: true,
          phone: true,
          partyNo: true,
        },
      });
    }

    if (no) customers.sort((a, b) => Number(b.partyNo === no) - Number(a.partyNo === no));
    return NextResponse.json({ data: customers });
  } catch (error) {
    console.error("Error searching customers:", error);
    return NextResponse.json({ error: "Failed to search customers" }, { status: 500 });
  }
}
