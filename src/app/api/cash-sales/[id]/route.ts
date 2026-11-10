// src/app/api/cash-sales/[id]/route.ts - One record from the old Cash Sales screen (read-only since 2026-11-10)
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("cashSales", "read");
  if (auth.response) return auth.response;

  const { id } = await params;
  const sale = await prisma.cashSale.findUnique({ where: { id } });
  if (!sale) return NextResponse.json({ error: "Cash sale not found" }, { status: 404 });
  return NextResponse.json({ sale });
}

// Deleting used to remove the record but leave its Finance income behind; old records are now kept as they are
export async function DELETE() {
  const auth = await authorize("cashSales", "delete");
  if (auth.response) return auth.response;
  return NextResponse.json({ error: "Cash sales from the old screen are kept as they are and cannot be deleted." }, { status: 409 });
}
