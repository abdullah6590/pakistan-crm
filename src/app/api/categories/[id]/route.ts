// src/app/api/categories/[id]/route.ts - Item Group price per kg (Report 32 phase 1). GET says how many products a
// price change would update; PUT saves the price and, only when asked and with that number confirmed, updates the
// purchase rate of the group's products. Bills keep their own prices.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { groupPriceImpact, setGroupPrice } from "@/lib/catalog/groups";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("inventory", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json(serialize(await groupPriceImpact(prisma, id)));
  } catch (error) {
    return accountingError(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await accountingReady();
    return NextResponse.json(serialize(await setGroupPrice(prisma, { id: auth.user.id, role: auth.user.role }, id, await request.json())));
  } catch (error) {
    return accountingError(error);
  }
}
