// src/app/api/supplier-ledger/route.ts - Supplier Ledger from Books (Report 30 §7): purchase bills raise what is owed to
// the supplier; payments, returns and refunds lower it, with a running balance. Purchases from before Purchases moved to
// Books are under Purchases → Older purchases.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { supplierStatement } from "@/lib/purchases/queries";

export async function GET(request: NextRequest) {
  const auth = await authorize("suppliers", "read");
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const supplierId = searchParams.get("supplierId");
  if (!supplierId) return NextResponse.json({ error: "supplierId is required" }, { status: 400 });

  const st = await supplierStatement(prisma, supplierId, { from: searchParams.get("startDate") ?? undefined, to: searchParams.get("endDate") ?? undefined });
  if (!st) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  // This screen's columns: "debit" = purchased (owed to the supplier), "credit" = paid, returned or refunded
  const ledger = [
    ...(Number(st.opening) !== 0 ? [{ id: "opening", date: st.from, type: "OPENING", description: "Opening balance", debit: 0, credit: 0, reference: null, details: "", balance: Number(st.opening) }] : []),
    ...st.rows.map((r) => ({
      id: r.docId, date: r.date, type: r.kind === "Purchase bill" ? "PURCHASE" : r.kind === "Payment" ? "PAYMENT" : r.kind.toUpperCase().replace(/ /g, "_"),
      description: `${r.kind} ${r.docNo}${r.reference ? ` (${r.reference})` : ""}`, debit: Number(r.credit), credit: Number(r.debit), reference: r.docNo,
      details: [r.remaining !== undefined ? `Still payable on this bill: ${r.remaining}` : null, r.remarks].filter(Boolean).join(" · "),
      balance: Number(r.balance),
    })),
  ];
  return NextResponse.json({
    supplier: { ...st.supplier, company: null, balanceDue: Number(st.closing) },
    ledger,
    summary: { totalPurchased: Number(st.totalCredit), totalPaid: Number(st.totalDebit), balanceDue: Number(st.closing) },
  });
}
