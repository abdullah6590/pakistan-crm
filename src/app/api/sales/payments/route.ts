// src/app/api/sales/payments/route.ts - Customer payments against their bills (Report 28 §2).
// GET ?customerId=  what the customer owes per bill, their unapplied credit and balance.
// POST              record money received and the bills it pays (nothing is allocated automatically).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { run } from "@/lib/accounting/posting";
import { receivePayment } from "@/lib/accounting/receivables";
import { accountForPayment, partyForCustomer } from "@/lib/sales/books-sales";
import { customerAccount } from "@/lib/sales/books-queries";
import { receivePaymentSchema } from "@/lib/sales/schemas";
import { isAuthority } from "@/lib/sync/local";
import { queueScreenEntry } from "@/lib/sync/screen-commands";

export async function GET(request: NextRequest) {
  const auth = await authorize("customerPayments", "read");
  if (auth.response) return auth.response;
  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  const account = await customerAccount(prisma, customerId);
  if (!account) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json(serialize({ account }));
}

export async function POST(request: NextRequest) {
  const auth = await authorize("customerPayments", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = receivePaymentSchema.parse(await request.json());
    if (!isAuthority()) {
      const { requestId, allocations, ...rest } = input;
      return queueScreenEntry("RECEIVE_PAYMENT", auth.user.id, { ...rest, allocations: allocations.map((a) => ({ invoice: { id: a.invoiceId }, amount: a.amount })) }, requestId);
    }
    const actor = { id: auth.user.id, role: auth.user.role };
    // Accounts first (each is created once and reused), then the payment on its own so a repeated submit is answered
    // with the first result
    const { party, cash } = await run(prisma, async (tx) => ({
      party: await partyForCustomer(tx, input.customerId, actor.id),
      cash: await accountForPayment(tx, input.method, input.cashAccountId, actor.id),
    }));
    const result = await receivePayment(prisma, actor, {
      partyAccountId: party.id, cashAccountId: cash.id, date: input.date, amount: input.amount,
      allocations: input.allocations, remarks: input.remarks, requestId: input.requestId,
    });
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
