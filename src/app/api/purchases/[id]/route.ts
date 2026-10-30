// src/app/api/purchases/[id]/route.ts - One purchase bill (Report 30): view it, correct it (a new revision that keeps its
// payments) or cancel it (full reversal of stock and accounts; its payments become the supplier's credit). Purchase
// orders from the old Purchases table are read-only.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { PostingError, cancelDocument } from "@/lib/accounting/posting";
import { amendScreenPurchase } from "@/lib/purchases/books-purchases";
import { loadPurchaseBill } from "@/lib/purchases/queries";
import { amendPurchaseSchema, cancelSchema } from "@/lib/purchases/schemas";

const OLDER = "This purchase was entered before Purchases moved to Books and can no longer be changed; enter a new bill instead";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("purchases", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const bill = await loadPurchaseBill(prisma, id);
  if (bill) return NextResponse.json(serialize({ bill }));
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: { supplier: true, items: { include: { component: { select: { id: true, name: true, sku: true } } } }, user: { select: { name: true } } },
  });
  if (!purchase) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  return NextResponse.json({ purchase, older: true });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("purchases", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await accountingReady();
    if (await prisma.purchase.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: OLDER }, { status: 409 });
    const { reason, ...input } = amendPurchaseSchema.parse(await request.json());
    const result = await amendScreenPurchase(prisma, { id: auth.user.id, role: auth.user.role }, id, {
      ...input, vendorBillDate: input.vendorBillDate || null, dueDate: input.dueDate || null, biltyDate: input.biltyDate || null,
    }, reason);
    return NextResponse.json(serialize({ purchase: result.document, releasedCredit: result.releasedCredit }));
  } catch (error) {
    return accountingError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Cancelling a purchase bill is for those who may delete purchases (administrators)
  const auth = await authorize("purchases", "delete");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    if (await prisma.purchase.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: OLDER }, { status: 409 });
    const { reason } = cancelSchema.parse(await request.json().catch(() => ({})));
    const doc = await prisma.accountingDocument.findUnique({ where: { id } });
    if (!doc || doc.type !== "PURCHASE_INVOICE") throw new PostingError("Purchase bill not found", 404);
    const cancelled = await cancelDocument(prisma, { id: auth.user.id, role: auth.user.role }, id, reason);
    return NextResponse.json(serialize({ purchase: cancelled }));
  } catch (error) {
    return accountingError(error);
  }
}
