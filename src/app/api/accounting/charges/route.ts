// src/app/api/accounting/charges/route.ts - List and record freight, loading, bilty and printing charges.
// Recording never posts to the accounts (owner rule of 2026-10-22).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { standaloneChargeSchema } from "@/lib/accounting/schemas";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { listCharges, recordCharge } from "@/lib/accounting/charges";
import { isAuthority, localDevice } from "@/lib/sync/local";
import { submitCommand, OutboxError } from "@/lib/sync/outbox";

export async function GET(request: NextRequest) {
  const auth = await authorize("charges", "read");
  if (auth.response) return auth.response;
  const { searchParams } = new URL(request.url);
  const charges = await listCharges(prisma, {
    status: searchParams.get("status") ?? undefined,
    kind: searchParams.get("kind") ?? undefined,
    documentId: searchParams.get("documentId") ?? undefined,
  });
  return NextResponse.json(serialize({ charges }));
}

export async function POST(request: NextRequest) {
  const auth = await authorize("charges", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = standaloneChargeSchema.parse(await request.json());
    if (!isAuthority()) {
      const { documentId, ...rest } = input;
      const entry = await submitCommand(prisma, localDevice(), { type: "RECORD_CHARGE", actorUserId: auth.user.id, input: rest, documentRef: documentId ? { id: documentId } : undefined });
      return NextResponse.json(serialize({ pending: true, entry }), { status: 201 });
    }
    const charge = await recordCharge(prisma, { id: auth.user.id, role: auth.user.role }, input);
    return NextResponse.json(serialize({ charge }), { status: 201 });
  } catch (error) {
    if (error instanceof OutboxError) return NextResponse.json({ error: error.message }, { status: error.status });
    return accountingError(error);
  }
}
