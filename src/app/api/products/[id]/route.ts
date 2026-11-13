// src/app/api/products/[id]/route.ts - Edit a product on the Add New Product screen (Report 32 phase 1). The packet
// size is locked once stock has moved; an administrator may correct it with a written reason (audited).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { updateProduct } from "@/lib/catalog/products";
import { productRow } from "@/lib/catalog/rows";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await accountingReady();
    const product = await updateProduct(prisma, { id: auth.user.id, role: auth.user.role }, id, await request.json());
    return NextResponse.json(serialize({ product: productRow(product) }));
  } catch (error) {
    return accountingError(error);
  }
}
