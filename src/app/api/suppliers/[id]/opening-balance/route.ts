// src/app/api/suppliers/[id]/opening-balance/route.ts - A supplier's opening balance, once, by an administrator with a
// written reason (Report 30 §1). It is a Books opening-balance document; it can be paid like a bill.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { run } from "@/lib/accounting/posting";
import { supplierOpeningBalance } from "@/lib/accounting/payables";
import { partyForSupplier } from "@/lib/purchases/books-purchases";
import { openingBalanceSchema } from "@/lib/purchases/schemas";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("suppliers", "write");
  if (auth.response) return auth.response;
  if (auth.user.role !== "ADMIN") return NextResponse.json({ error: "Only an administrator can enter an opening balance" }, { status: 403 });
  const { id } = await params;
  try {
    await accountingReady();
    const input = openingBalanceSchema.parse(await request.json());
    const actor = { id: auth.user.id, role: auth.user.role };
    const party = await run(prisma, (tx) => partyForSupplier(tx, id, actor.id, { allowInactive: true }));
    const result = await supplierOpeningBalance(prisma, actor, { partyAccountId: party.id, ...input });
    return NextResponse.json(serialize(result), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
