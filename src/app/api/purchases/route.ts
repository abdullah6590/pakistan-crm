// src/app/api/purchases/route.ts - Purchases on Books (Report 30): list purchase bills and enter one. Stock, cost and the
// supplier's payable are posted once, by the Books posting service. Purchase orders entered before Purchases moved to
// Books are in the old Purchases table and are listed with `?older=1` (read-only).
import { NextRequest, NextResponse } from "next/server";
import { authorize, can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { createScreenPurchase } from "@/lib/purchases/books-purchases";
import { listPurchaseBills } from "@/lib/purchases/queries";
import { screenPurchaseSchema } from "@/lib/purchases/schemas";
import { isAuthority } from "@/lib/sync/local";
import { queueScreenEntry } from "@/lib/sync/screen-commands";

export async function GET(request: NextRequest) {
  const auth = await authorize("purchases", "read");
  if (auth.response) return auth.response;
  const p = new URL(request.url).searchParams;
  if (p.get("older") === "1") {
    const purchases = await prisma.purchase.findMany({
      include: { supplier: { select: { id: true, name: true } }, items: { include: { component: { select: { id: true, name: true, sku: true } } } }, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(p.get("limit")) || 100, 500),
    });
    return NextResponse.json({ purchases });
  }
  await accountingReady();
  const result = await listPurchaseBills(prisma, {
    search: p.get("search") ?? undefined, supplierId: p.get("supplierId") ?? undefined, status: p.get("status") ?? undefined,
    from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, page: Number(p.get("page")) || 1,
  });
  return NextResponse.json(serialize(result));
}

export async function POST(request: NextRequest) {
  const auth = await authorize("purchases", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = screenPurchaseSchema.parse(await request.json());
    // Paying the supplier is for those who may make supplier payments
    if (input.paidNow && Number(input.paidNow.amount) > 0 && !can(auth.user.role, "supplierPayments", "write")) {
      return NextResponse.json({ error: "Only an administrator or accountant can record a payment to the supplier; save the bill unpaid" }, { status: 403 });
    }
    if (!isAuthority()) {
      const { requestId, ...rest } = input;
      return queueScreenEntry("SCREEN_PURCHASE", auth.user.id, rest, requestId);
    }
    const result = await createScreenPurchase(prisma, { id: auth.user.id, role: auth.user.role }, {
      ...input, vendorBillDate: input.vendorBillDate || null, dueDate: input.dueDate || null, biltyDate: input.biltyDate || null,
    });
    return NextResponse.json(serialize({ purchase: result.document, payment: result.payment, repeated: result.repeated }), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
