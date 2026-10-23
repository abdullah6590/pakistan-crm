// src/app/api/accounting/charges/[id]/route.ts - Post a recorded charge as an expense, reverse, edit or cancel it.
// Duplicate postings are refused by the service (one active posting per charge), not only by the screen.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { chargeActionSchema } from "@/lib/accounting/schemas";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { postChargeAsExpense, reverseChargePosting, editCharge, cancelCharge } from "@/lib/accounting/charges";
import { isAuthority, localDevice, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";
import { submitCommand, OutboxError } from "@/lib/sync/outbox";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("charges", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const charge = await prisma.chargeRecord.findUnique({
    where: { id },
    include: { document: { select: { id: true, docNo: true, type: true } }, postings: { select: { id: true, docNo: true, status: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!charge) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
  const history = await prisma.auditLog.findMany({ where: { entity: "ChargeRecord", entityId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(serialize({ charge, history }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = chargeActionSchema.parse(await request.json().catch(() => ({})));
    const offline = { offlineCapable: body.action !== "edit" };
    const auth =
      body.action === "post" ? await authorize("chargePosting", "write", offline)
      : body.action === "reverse" ? await authorize("chargePosting", "delete", offline)
      : body.action === "cancel" ? await authorize("charges", "delete", offline)
      : await authorize("charges", "write");
    if (auth.response) return auth.response;
    const actor = { id: auth.user.id, role: auth.user.role };
    await accountingReady();
    if (!isAuthority()) {
      if (body.action === "edit") return NextResponse.json({ error: OFFLINE_ONLY_MESSAGE }, { status: 503 });
      const current = await prisma.chargeRecord.findUniqueOrThrow({ where: { id }, select: { status: true } });
      const entry = await submitCommand(prisma, localDevice(), {
        type: "CHARGE_ACTION", actorUserId: actor.id, action: body.action, target: { id }, expect: { status: current.status },
        reason: body.action === "post" ? undefined : body.reason,
        post: body.action === "post"
          ? { settlement: body.settlement, expenseAccountId: body.expenseAccountId, cashAccountId: body.cashAccountId, payeeAccountId: body.payeeAccountId, date: typeof body.date === "string" ? body.date : undefined }
          : undefined,
      });
      return NextResponse.json(serialize({ pending: true, entry }), { status: 202 });
    }
    const result =
      body.action === "post" ? await postChargeAsExpense(prisma, actor, id, body)
      : body.action === "reverse" ? await reverseChargePosting(prisma, actor, id, body.reason)
      : body.action === "cancel" ? await cancelCharge(prisma, actor, id, body.reason)
      : await editCharge(prisma, actor, id, body.patch, body.reason);
    return NextResponse.json(serialize(result));
  } catch (error) {
    if (error instanceof OutboxError) return NextResponse.json({ error: error.message }, { status: error.status });
    return accountingError(error);
  }
}
