// src/app/api/purchases/payables/route.ts - Outstanding payables (Report 30 §7): unpaid and part-paid bills by supplier
// with their age, due date and any supplier credit.
import { NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingReady, serialize } from "@/lib/accounting/server";
import { payablesReport } from "@/lib/purchases/queries";

export async function GET() {
  const auth = await authorize("supplierPayments", "read");
  if (auth.response) return auth.response;
  await accountingReady();
  return NextResponse.json(serialize({ report: await payablesReport(prisma) }));
}
