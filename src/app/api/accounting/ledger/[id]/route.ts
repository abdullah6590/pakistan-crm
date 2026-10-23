// src/app/api/accounting/ledger/[id]/route.ts - Account statement with opening balance and item rows (F-05).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountStatement } from "@/lib/accounting/queries";
import { serialize } from "@/lib/accounting/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("ledgers", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const statement = await accountStatement(prisma, id, {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  });
  if (!statement) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(serialize({ statement }));
}
