// src/app/api/sales/route.ts - Sales on Books (Report 28): list bills and make a bill.
// A registered customer's bill is a Books sale invoice; a walk-in bill is a cash sale. Bills made before Sales moved
// to Books are in the old Sales table and are listed with `?older=1` (read-only).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { createScreenSale } from "@/lib/sales/books-sales";
import { listBills } from "@/lib/sales/books-queries";
import { screenSaleSchema } from "@/lib/sales/schemas";
import { isAuthority } from "@/lib/sync/local";
import { queueScreenEntry } from "@/lib/sync/screen-commands";

export async function GET(request: NextRequest) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;
  const p = new URL(request.url).searchParams;
  if (p.get("older") === "1") {
    const sales = await prisma.sale.findMany({
      include: { customer: { select: { id: true, name: true, phone: true } }, items: { include: { component: { select: { id: true, name: true, sku: true } } } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(p.get("limit")) || 50, 100),
    });
    return NextResponse.json({ sales });
  }
  const result = await listBills(prisma, {
    search: p.get("search") ?? undefined, customerId: p.get("customerId") ?? undefined, status: p.get("status") ?? undefined,
    from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, page: Number(p.get("page")) || 1,
  });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await authorize("sales", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = screenSaleSchema.parse(await request.json());
    if (!isAuthority()) {
      const { requestId, ...rest } = input;
      return queueScreenEntry("SCREEN_SALE", auth.user.id, rest, requestId);
    }
    const result = await createScreenSale(prisma, { id: auth.user.id, role: auth.user.role }, input);
    return NextResponse.json(serialize({ sale: result.document, receipt: result.receipt, repeated: result.repeated }), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
