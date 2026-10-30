// src/app/api/customer-payments/[id]/route.ts - Individual customer payment CRUD
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("customerPayments", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const { id } = await params;
  const payment = await prisma.customerPayment.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });

  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json({ payment });
}

/** Older payments are kept as they are: never deleted (Report 28). A Books receipt is cancelled from its voucher. */
export async function DELETE() {
  const auth = await authorize("customerPayments", "delete");
  if (auth.response) return auth.response;
  return NextResponse.json({ error: "Older customer payments are kept as records and cannot be deleted" }, { status: 409 });
}
