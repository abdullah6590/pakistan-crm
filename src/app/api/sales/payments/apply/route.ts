// src/app/api/sales/payments/apply/route.ts - Apply a customer's unapplied credit to one of their bills (Report 28).
// Moves no money and posts nothing: it only records which bill the earlier receipt paid.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, serialize } from "@/lib/accounting/server";
import { applyCredit } from "@/lib/accounting/receivables";
import { applyCreditSchema } from "@/lib/sales/schemas";

export async function POST(request: NextRequest) {
  const auth = await authorize("customerPayments", "write");
  if (auth.response) return auth.response;
  try {
    const input = applyCreditSchema.parse(await request.json());
    const result = await applyCredit(prisma, { id: auth.user.id, role: auth.user.role }, input);
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
