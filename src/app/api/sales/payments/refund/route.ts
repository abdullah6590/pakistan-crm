// src/app/api/sales/payments/refund/route.ts - Pay a customer's unapplied credit back (Report 28 §3).
// Money leaves a cash or bank account, so only those who may enter payment vouchers can do it.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { run } from "@/lib/accounting/posting";
import { refundCredit } from "@/lib/accounting/receivables";
import { accountForPayment, partyForCustomer } from "@/lib/sales/books-sales";
import { refundSchema } from "@/lib/sales/schemas";

export async function POST(request: NextRequest) {
  const auth = await authorize("vouchers", "write");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = refundSchema.parse(await request.json());
    const actor = { id: auth.user.id, role: auth.user.role };
    const { party, cash } = await run(prisma, async (tx) => ({
      party: await partyForCustomer(tx, input.customerId, actor.id),
      cash: await accountForPayment(tx, input.method, input.cashAccountId, actor.id),
    }));
    const result = await refundCredit(prisma, actor, { partyAccountId: party.id, cashAccountId: cash.id, date: input.date, amount: input.amount, remarks: input.remarks, requestId: input.requestId });
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
