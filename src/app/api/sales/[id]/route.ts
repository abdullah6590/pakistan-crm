// src/app/api/sales/[id]/route.ts - One bill (Report 28): view it, correct it (a new revision that keeps its payments),
// or cancel it (full reversal; its payments become the customer's credit). Bills from the old Sales table are read-only.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { PostingError, cancelDocument } from "@/lib/accounting/posting";
import { amendScreenSale } from "@/lib/sales/books-sales";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { amendSaleSchema, cancelSchema } from "@/lib/sales/schemas";

const OLDER = "This bill was made before Sales moved to Books and can no longer be changed; make a new bill instead";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const bill = await loadBooksBill(prisma, id);
  if (bill) return NextResponse.json(serialize({ bill }));
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { customer: true, items: { include: { component: { select: { id: true, name: true, sku: true } } } }, user: { select: { name: true } } },
  });
  if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  return NextResponse.json({ sale, older: true });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("sales", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await accountingReady();
    if (await prisma.sale.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: OLDER }, { status: 409 });
    const { reason, ...input } = amendSaleSchema.parse(await request.json());
    const result = await amendScreenSale(prisma, { id: auth.user.id, role: auth.user.role }, id, input, reason);
    return NextResponse.json(serialize({ sale: result.document, releasedCredit: result.releasedCredit }));
  } catch (error) {
    return accountingError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Cancelling a bill is for those who may delete sales (administrators), as before Sales moved to Books
  const auth = await authorize("sales", "delete");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    if (await prisma.sale.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: OLDER }, { status: 409 });
    const { reason } = cancelSchema.parse(await request.json().catch(() => ({})));
    const doc = await prisma.accountingDocument.findUnique({ where: { id } });
    if (!doc || !["SALE_INVOICE", "CASH_SALE"].includes(doc.type)) throw new PostingError("Bill not found", 404);
    const actor = { id: auth.user.id, role: auth.user.role };
    const cancelled = await cancelDocument(prisma, actor, id, reason);
    return NextResponse.json(serialize({ sale: cancelled }));
  } catch (error) {
    return accountingError(error);
  }
}
