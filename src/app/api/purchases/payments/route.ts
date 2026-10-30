// src/app/api/purchases/payments/route.ts - Paying suppliers against their bills (Report 30 §3).
// GET ?supplierId=   the supplier's open bills, credit and balance.
// GET ?list=1        payment history (optional supplierId, from, to).
// POST               record a payment and the bills it settles (nothing is allocated automatically).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { run } from "@/lib/accounting/posting";
import { paySupplier } from "@/lib/accounting/payables";
import { accountForPayment } from "@/lib/sales/books-sales";
import { partyForSupplier } from "@/lib/purchases/books-purchases";
import { supplierAccount, supplierPayments } from "@/lib/purchases/queries";
import { paySupplierSchema } from "@/lib/purchases/schemas";
import { isAuthority } from "@/lib/sync/local";
import { queueScreenEntry } from "@/lib/sync/screen-commands";

export async function GET(request: NextRequest) {
  const auth = await authorize("supplierPayments", "read");
  if (auth.response) return auth.response;
  const p = new URL(request.url).searchParams;
  await accountingReady();
  if (p.get("list") === "1") {
    const payments = await supplierPayments(prisma, { supplierId: p.get("supplierId") ?? undefined, from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, includeCancelled: p.get("cancelled") === "1" });
    return NextResponse.json(serialize({ payments }));
  }
  const supplierId = p.get("supplierId");
  if (!supplierId) return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
  const account = await supplierAccount(prisma, supplierId);
  if (!account) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  return NextResponse.json(serialize({ account }));
}

export async function POST(request: NextRequest) {
  const auth = await authorize("supplierPayments", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const input = paySupplierSchema.parse(await request.json());
    if (!isAuthority()) {
      const { requestId, allocations, ...rest } = input;
      return queueScreenEntry("PAY_SUPPLIER", auth.user.id, { ...rest, allocations: allocations.map((a) => ({ bill: { id: a.billId }, amount: a.amount })) }, requestId);
    }
    const actor = { id: auth.user.id, role: auth.user.role };
    // Accounts first (each is created once and reused), then the payment on its own so a repeated submit is answered
    // with the first result. An archived supplier can still be paid what is owed.
    const { party, cash } = await run(prisma, async (tx) => ({
      party: await partyForSupplier(tx, input.supplierId, actor.id, { allowInactive: true }),
      cash: await accountForPayment(tx, input.method, input.cashAccountId, actor.id),
    }));
    const result = await paySupplier(prisma, actor, {
      partyAccountId: party.id, cashAccountId: cash.id, date: input.date, amount: input.amount, reference: input.reference,
      allocations: input.allocations, remarks: input.remarks, requestId: input.requestId,
    });
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
