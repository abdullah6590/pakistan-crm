// src/app/api/accounting/documents/route.ts - List and create accounting documents (posting service).
import { NextRequest, NextResponse } from "next/server";
import { authorize, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DOCUMENT_SCHEMAS, DocumentType } from "@/lib/accounting/schemas";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { isAuthority, localDevice } from "@/lib/sync/local";
import { submitCommand, OutboxError } from "@/lib/sync/outbox";
import {
  createSaleInvoice, createCashSale, createPurchaseInvoice, createStockIssue, createPressDispatch, createPressReturn,
  createPressReceipt, createPressLoss, createVoucher, createTransfer, createOpeningBalance, Actor,
  createSaleReturn, createPurchaseReturn, createStockAdjustment,
} from "@/lib/accounting/posting";

const CREATE: Record<DocumentType, (actor: Actor, input: never) => Promise<unknown>> = {
  SALE_INVOICE: (a, i) => createSaleInvoice(prisma, a, i),
  CASH_SALE: (a, i) => createCashSale(prisma, a, i),
  PURCHASE_INVOICE: (a, i) => createPurchaseInvoice(prisma, a, i),
  STOCK_ISSUE: (a, i) => createStockIssue(prisma, a, i),
  PRESS_DISPATCH: (a, i) => createPressDispatch(prisma, a, i),
  PRESS_RETURN: (a, i) => createPressReturn(prisma, a, i),
  PRESS_RECEIPT: (a, i) => createPressReceipt(prisma, a, i),
  PRESS_LOSS: (a, i) => createPressLoss(prisma, a, i),
  SALE_RETURN: (a, i) => createSaleReturn(prisma, a, i),
  PURCHASE_RETURN: (a, i) => createPurchaseReturn(prisma, a, i),
  STOCK_ADJUSTMENT: (a, i) => createStockAdjustment(prisma, a, i),
  VOUCHER: (a, i) => createVoucher(prisma, a, i),
  TRANSFER: (a, i) => createTransfer(prisma, a, i),
  OPENING_BALANCE: (a, i) => createOpeningBalance(prisma, a, i),
};

function documentType(value: string | null): DocumentType | null {
  return value && value in DOCUMENT_SCHEMAS ? (value as DocumentType) : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Any known type can be listed, including CHARGE_EXPENSE postings, which are never created here
  const type = searchParams.get("type") ?? "";
  if (!(type in DOCUMENT_RESOURCE)) return NextResponse.json({ error: "Choose a document type" }, { status: 400 });
  const auth = await authorize(DOCUMENT_RESOURCE[type], "read");
  if (auth.response) return auth.response;

  const status = searchParams.get("status");
  const partyAccountId = searchParams.get("partyAccountId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search")?.trim();
  const take = Math.min(Number(searchParams.get("limit")) || 100, 500);

  const documents = await prisma.accountingDocument.findMany({
    where: {
      type,
      ...(status ? { status } : {}),
      ...(partyAccountId ? { partyAccountId } : {}),
      ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {}),
      ...(search ? { OR: [{ docNo: { contains: search } }, { remarks: { contains: search } }, { partyAccount: { name: { contains: search } } }] } : {}),
    },
    include: { partyAccount: { select: { id: true, name: true } }, cashAccount: { select: { id: true, name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
  return NextResponse.json(serialize({ documents }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const type = documentType(body?.type ?? null);
  if (!type) return NextResponse.json({ error: "Choose a document type" }, { status: 400 });
  const auth = await authorize(DOCUMENT_RESOURCE[type], "write", { offlineCapable: true });
  if (auth.response) return auth.response;

  try {
    await accountingReady();
    const input = DOCUMENT_SCHEMAS[type].parse(body);
    if (!isAuthority()) {
      // Device / hub: queue the entry for the server; the preview uses the server's own rules (Report 21 §2)
      const entry = await submitCommand(prisma, localDevice(), { type: "CREATE_DOCUMENT", actorUserId: auth.user.id, docType: type, input });
      return NextResponse.json(serialize({ pending: true, entry }), { status: 201 });
    }
    const document = await CREATE[type]({ id: auth.user.id, role: auth.user.role }, input as never);
    return NextResponse.json(serialize({ document }), { status: 201 });
  } catch (error) {
    if (error instanceof OutboxError) return NextResponse.json({ error: error.message }, { status: error.status });
    return accountingError(error);
  }
}
