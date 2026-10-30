// src/app/api/purchases/payments/refund/route.ts - Money a supplier pays back out of their credit (an overpayment or
// goods returned after the bill was paid). A cash or bank receipt, funded by the payments and returns it draws on.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { run } from "@/lib/accounting/posting";
import { supplierRefund } from "@/lib/accounting/payables";
import { accountForPayment } from "@/lib/sales/books-sales";
import { partyForSupplier } from "@/lib/purchases/books-purchases";
import { supplierRefundSchema } from "@/lib/purchases/schemas";

export async function POST(request: NextRequest) {
  const auth = await authorize("supplierPayments", "write");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = supplierRefundSchema.parse(await request.json());
    const actor = { id: auth.user.id, role: auth.user.role };
    const { party, cash } = await run(prisma, async (tx) => ({
      party: await partyForSupplier(tx, input.supplierId, actor.id, { allowInactive: true }),
      cash: await accountForPayment(tx, input.method, input.cashAccountId, actor.id),
    }));
    const result = await supplierRefund(prisma, actor, {
      partyAccountId: party.id, cashAccountId: cash.id, date: input.date, amount: input.amount, reference: input.reference, remarks: input.remarks, requestId: input.requestId,
    });
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
