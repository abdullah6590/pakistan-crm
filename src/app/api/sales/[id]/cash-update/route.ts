// src/app/api/sales/[id]/cash-update/route.ts - The old Cash Sale "Cash Update" (Report 33): more cash received on a
// part-paid cash sale, recorded as a cash or bank receipt allocated to that bill. The bill itself is never edited, so
// its lines, prices and stock stay as saved; the payment history and what is still owed follow from the allocations.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { PostingError, run } from "@/lib/accounting/posting";
import { invoicePayments, receivePayment } from "@/lib/accounting/receivables";
import { accountForPayment } from "@/lib/sales/books-sales";
import { isAuthority, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";

const schema = z.object({
  amount: z.union([z.number(), z.string().trim().min(1)]),
  method: z.string().min(1).default("CASH"),
  cashAccountId: z.string().optional(),
  date: z.string().optional(),
  remarks: z.string().max(500).optional(),
  requestId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("customerPayments", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    // A walk-in has no customer record a computer could queue the receipt against: this needs the main server
    if (!isAuthority()) throw new PostingError(OFFLINE_ONLY_MESSAGE, 409);
    await accountingReady();
    const input = schema.parse(await request.json());
    const bill = await prisma.accountingDocument.findUnique({ where: { id } });
    if (!bill || bill.type !== "CASH_SALE") throw new PostingError("Cash sale not found", 404);
    if (bill.status !== "POSTED") throw new PostingError(`${bill.docNo} is ${bill.status.toLowerCase()}; cash goes to its current version`, 409);
    if (!bill.partyAccountId) throw new PostingError(`${bill.docNo} was paid in full; nothing is owed on it`, 409);
    const actor = { id: auth.user.id, role: auth.user.role };
    const cash = await run(prisma, (tx) => accountForPayment(tx, input.method, input.cashAccountId, actor.id));
    const r = await receivePayment(prisma, actor, {
      partyAccountId: bill.partyAccountId, cashAccountId: cash.id, date: input.date ?? new Date().toISOString().slice(0, 10),
      amount: input.amount, allocations: [{ invoiceId: bill.id, amount: input.amount }],
      remarks: input.remarks?.trim() || `Cash update for ${bill.docNo}${bill.walkInName ? ` (${bill.walkInName})` : ""}`,
      requestId: input.requestId,
    });
    return NextResponse.json(serialize({ receipt: r.receipt, repeated: r.repeated, payments: await invoicePayments(prisma, bill.id) }), { status: r.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
