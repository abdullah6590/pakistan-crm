// src/app/api/sales/receipts/[id]/pdf/route.ts - A payment receipt as PDF (Report 28 §5): amount in figures and words,
// the bills it paid, anything refunded, and any part kept as the customer's credit.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { dec, sub, toPlain, ZERO, add } from "@/lib/domain/decimal";
import { getSetting } from "@/lib/accounting/setup";
import { RECEIPT_SERIES } from "@/lib/accounting/allocations";
import { rupeesInWords } from "@/lib/sales/books-queries";
import { receiptPdf } from "@/lib/books-pdf";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("customerPayments", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const r = await prisma.accountingDocument.findUnique({
    where: { id },
    include: {
      partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } },
      allocationsGiven: { where: { releasedAt: null }, include: { debitDoc: { select: { docNo: true, type: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!r || r.type !== "VOUCHER" || !(RECEIPT_SERIES as readonly string[]).includes(r.series)) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const toBills = r.allocationsGiven.filter((a) => a.debitDoc.type !== "VOUCHER");
  const refunded = r.allocationsGiven.filter((a) => a.debitDoc.type === "VOUCHER").reduce((t, a) => add(t, dec(a.amount)), ZERO);
  const used = r.allocationsGiven.reduce((t, a) => add(t, dec(a.amount)), ZERO);
  const [businessName, businessAddress] = await Promise.all([getSetting(prisma, "BUSINESS_NAME"), getSetting(prisma, "BUSINESS_ADDRESS")]);
  const pdf = await receiptPdf({
    business: { name: businessName || "Paper Mill ERP", address: businessAddress || "" },
    receiptNo: r.docNo, cancelled: r.status === "CANCELLED", date: r.date,
    customer: r.partyAccount?.name ?? "", method: r.cashAccount?.name ?? (r.series === "BRV" ? "Bank" : "Cash"),
    amount: r.total, words: rupeesInWords(r.total),
    appliedTo: toBills.map((a) => ({ docNo: a.debitDoc.docNo, amount: a.amount })),
    refunded: toPlain(refunded), unapplied: toPlain(sub(dec(r.total), used)),
    remarks: r.remarks, printedBy: auth.user.name,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${request.nextUrl.searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="Receipt-${r.docNo.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
