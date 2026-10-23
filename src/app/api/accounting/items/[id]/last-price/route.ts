// src/app/api/accounting/items/[id]/last-price/route.ts - BR-10 last purchase / sale price for pre-filling documents.
import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lastPrices } from "@/lib/accounting/queries";
import { serialize } from "@/lib/accounting/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const canSales = can(user.role, "sales", "read") || can(user.role, "cashSales", "read");
  const canPurchases = can(user.role, "purchases", "read");
  if (!canSales && !canPurchases) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const prices = await lastPrices(prisma, id);
  // Each side only for roles that may see that module's prices
  return NextResponse.json(serialize({ purchase: canPurchases ? prices.purchase : null, sale: canSales ? prices.sale : null }));
}
