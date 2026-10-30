// src/app/api/customer-ledger/route.ts - Customer Ledger from Books (Report 28 §6): bills raise what the customer owes,
// payments and returns lower it, with a running balance. Bills from before Sales moved to Books are under Older bills.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { customerStatement } from "@/lib/sales/statement";

export async function GET(request: NextRequest) {
  const auth = await authorize("customers", "read");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  const st = await customerStatement(prisma, customerId, { from: searchParams.get("startDate") ?? undefined, to: searchParams.get("endDate") ?? undefined });
  if (!st) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const ledger = [
    ...(Number(st.opening) !== 0 ? [{ id: "opening", date: st.from, type: "OPENING", description: "Opening balance", debit: 0, credit: 0, reference: null, details: "", balance: Number(st.opening) }] : []),
    ...st.rows.map((r) => ({
      id: r.docId, date: r.date, type: r.kind === "Bill" || r.kind === "Cash sale" ? "SALE" : r.kind === "Payment received" ? "RECEIPT" : r.kind.toUpperCase(),
      description: `${r.kind} ${r.docNo}`, debit: Number(r.debit), credit: Number(r.credit), reference: r.docNo,
      details: [r.remaining !== undefined ? `Still owed on this bill: ${r.remaining}` : null, r.remarks].filter(Boolean).join(" · "),
      balance: Number(r.balance),
    })),
  ];
  return NextResponse.json({
    customer: { ...st.customer, balanceDue: Number(st.closing) },
    ledger,
    summary: { totalSales: Number(st.totalDebit), totalReceived: Number(st.totalCredit), balanceDue: Number(st.closing) },
  });
}
