// src/app/api/purchases/payments/apply/route.ts - Use a supplier's credit (an advance payment or returned goods) for one
// of their bills. Moves no money and posts nothing; only records which bill the credit settles.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { applySupplierCredit } from "@/lib/accounting/payables";
import { applySupplierCreditSchema } from "@/lib/purchases/schemas";

export async function POST(request: NextRequest) {
  const auth = await authorize("supplierPayments", "write");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = applySupplierCreditSchema.parse(await request.json());
    const result = await applySupplierCredit(prisma, { id: auth.user.id, role: auth.user.role }, input);
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
