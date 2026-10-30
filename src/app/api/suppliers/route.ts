// src/app/api/suppliers/route.ts - Suppliers (Report 30 §1): list with their balance from Books, and add one with a
// duplicate check. `?check=1&name=&phone=` only looks for possible duplicates (nothing is saved).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { createSupplier, possibleDuplicates } from "@/lib/purchases/suppliers";
import { supplierList } from "@/lib/purchases/queries";
import { supplierSchema } from "@/lib/purchases/schemas";

export async function GET(request: NextRequest) {
  const auth = await authorize("suppliers", "read");
  if (auth.response) return auth.response;
  const p = new URL(request.url).searchParams;
  if (p.get("check") === "1") {
    return NextResponse.json({ duplicates: await possibleDuplicates(prisma, { name: p.get("name"), phone: p.get("phone") }, p.get("exceptId") ?? undefined) });
  }
  await accountingReady();
  const status = (["active", "archived", "all"] as const).find((s) => s === p.get("status")) ?? "active";
  const suppliers = await supplierList(prisma, { search: p.get("search") ?? undefined, status, withBalance: p.get("withBalance") === "1" });
  return NextResponse.json(serialize({ suppliers }));
}

export async function POST(request: NextRequest) {
  const auth = await authorize("suppliers", "write");
  if (auth.response) return auth.response;
  try {
    const { customFields, ...input } = supplierSchema.parse(await request.json());
    const supplier = await createSupplier(prisma, auth.user.id, { ...input, customFields: customFields ? JSON.stringify(customFields) : null });
    return NextResponse.json({ success: true, supplier }, { status: 201 });
  } catch (error) {
    return accountingError(error);
  }
}
