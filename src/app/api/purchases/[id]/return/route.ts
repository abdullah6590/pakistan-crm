// src/app/api/purchases/[id]/return/route.ts - Return goods to the supplier against a purchase bill (Report 30 §6).
// Stock leaves at the value it came in with; the return settles the bill's payable, and anything beyond what was still
// owed (the bill was already paid) becomes the supplier's credit.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { returnToSupplier } from "@/lib/accounting/payables";
import { purchaseReturnSchema } from "@/lib/purchases/schemas";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("purchases", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await accountingReady();
    const input = purchaseReturnSchema.parse(await request.json());
    const result = await returnToSupplier(prisma, { id: auth.user.id, role: auth.user.role }, { ...input, originalDocumentId: id });
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
