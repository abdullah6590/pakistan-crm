// src/app/api/purchases/payments/[id]/pdf/route.ts - The voucher of a supplier payment (or of money a supplier refunded)
// as a PDF (Report 30 §7): who was paid, from which account, the reference and the bills it settled.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { dec, sub, toPlain, ZERO, add } from "@/lib/domain/decimal";
import { getSetting } from "@/lib/accounting/setup";
import { PAYMENT_SERIES, SUPPLIER_REFUND_SERIES } from "@/lib/accounting/payables";
import { rupeesInWords } from "@/lib/sales/books-queries";
import { paymentVoucherPdf } from "@/lib/books-pdf";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("supplierPayments", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const v = await prisma.accountingDocument.findUnique({
    where: { id },
    include: {
      partyAccount: true, cashAccount: true,
      allocationsGiven: { where: { releasedAt: null }, include: { debitDoc: { select: { docNo: true, vendorBillNo: true, type: true } } } },
    },
  });
  const series = [...PAYMENT_SERIES, ...SUPPLIER_REFUND_SERIES] as string[];
  if (!v || v.type !== "VOUCHER" || !series.includes(v.series) || v.partyAccount?.subType !== "SUPPLIER") {
    return NextResponse.json({ error: "Supplier payment not found" }, { status: 404 });
  }
  const refund = (SUPPLIER_REFUND_SERIES as readonly string[]).includes(v.series);
  const bills = v.allocationsGiven.filter((a) => a.debitDoc.type !== "VOUCHER");
  const used = v.allocationsGiven.reduce((t, a) => add(t, dec(a.amount)), ZERO);
  const [name, address] = await Promise.all([getSetting(prisma, "BUSINESS_NAME"), getSetting(prisma, "BUSINESS_ADDRESS")]);
  const pdf = await paymentVoucherPdf({
    business: { name: name || "Paper Mill ERP", address: address || "" },
    docNo: v.docNo, kind: refund ? "REFUND_RECEIVED" : "PAYMENT", cancelled: v.status === "CANCELLED", date: v.date,
    supplier: v.partyAccount!.name, supplierCode: v.partyAccount!.code, account: v.cashAccount?.name ?? "", reference: v.vendorBillNo,
    amount: v.total, words: rupeesInWords(v.total),
    bills: bills.map((a) => ({ docNo: a.debitDoc.docNo, vendorBillNo: a.debitDoc.vendorBillNo, amount: a.amount })),
    unapplied: refund ? "0" : toPlain(sub(dec(v.total), used)), remarks: v.remarks, printedBy: auth.user.name,
  });
  const inline = request.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="Voucher-${v.docNo.replace(/\//g, "-")}.pdf"`, "Cache-Control": "no-store" },
  });
}
