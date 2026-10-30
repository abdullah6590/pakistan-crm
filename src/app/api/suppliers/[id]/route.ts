// src/app/api/suppliers/[id]/route.ts - One supplier (Report 30 §1): profile with balance, bills, payments, credit and
// change history; edit (audited); archive or bring back. Suppliers are never deleted: their records stay.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { setSupplierActive, supplierHistory, updateSupplier } from "@/lib/purchases/suppliers";
import { listPurchaseBills, supplierAccount, supplierPayments } from "@/lib/purchases/queries";
import { archiveSchema, supplierUpdateSchema } from "@/lib/purchases/schemas";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("suppliers", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  await accountingReady();
  const account = await supplierAccount(prisma, id);
  if (!account) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  const [bills, payments, returns, history] = await Promise.all([
    listPurchaseBills(prisma, { supplierId: id }, 200),
    supplierPayments(prisma, { supplierId: id, includeCancelled: true }),
    account.partyAccountId
      ? prisma.accountingDocument.findMany({ where: { type: "PURCHASE_RETURN", partyAccountId: account.partyAccountId }, select: { id: true, docNo: true, date: true, total: true, status: true, returnOf: { select: { id: true, docNo: true } } }, orderBy: { date: "desc" } })
      : [],
    supplierHistory(prisma, account.supplier),
  ]);
  return NextResponse.json(serialize({ account, bills: bills.rows, payments, returns, history }));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("suppliers", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const { customFields, ...input } = supplierUpdateSchema.parse(await request.json());
    const supplier = await updateSupplier(prisma, auth.user.id, id, { ...input, ...(customFields ? { customFields: JSON.stringify(customFields) } : {}) });
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    return accountingError(error);
  }
}

/** Archive or bring back (`{ active, reason }`); nothing is deleted. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("suppliers", "delete");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const { active, reason } = archiveSchema.parse(await request.json());
    const supplier = await setSupplierActive(prisma, auth.user.id, id, active, reason);
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    return accountingError(error);
  }
}

export async function DELETE() {
  return NextResponse.json({ error: "Suppliers are not deleted; archive the supplier instead (their bills and payments stay)" }, { status: 405 });
}
