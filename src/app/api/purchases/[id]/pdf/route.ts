// src/app/api/purchases/[id]/pdf/route.ts - A purchase bill as a PDF (Report 30 §7): supplier reference, items, prices,
// total, what was paid and returned, and what is still payable. `?inline=1` opens it in the browser.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadPurchaseBill } from "@/lib/purchases/queries";
import { purchaseBillPdf } from "@/lib/books-pdf";

const STATUS: Record<string, string> = { UNPAID: "Unpaid", PARTIALLY_PAID: "Partially paid", PAID: "Paid", CANCELLED: "Cancelled", REPLACED: "Replaced by a newer version" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("purchases", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const b = await loadPurchaseBill(prisma, id);
  if (!b) return NextResponse.json({ error: "Purchase bill not found" }, { status: 404 });
  const { doc } = b;
  const pdf = await purchaseBillPdf({
    business: { name: b.businessName, address: b.businessAddress },
    docNo: doc.docNo,
    revisionNote: doc.revision > 0 ? `Revision R${doc.revision} of ${doc.docNo.split("/")[0]}` : null,
    cancelled: doc.status === "CANCELLED",
    date: doc.date, supplier: b.supplierName, supplierCode: b.supplierCode, supplierPhone: b.supplier?.phone,
    vendorBillNo: doc.vendorBillNo, vendorBillDate: doc.vendorBillDate, dueDate: doc.dueDate, biltyNo: doc.biltyNo,
    status: STATUS[b.status] ?? b.status,
    lines: doc.lines.map((l) => ({ description: l.description ?? "", sku: l.component?.sku, quantity: l.quantity, unit: l.unit, loose: l.loose, unitPrice: l.unitPrice, amount: l.amount })),
    total: b.total, paid: b.paid, returned: b.returned, remaining: b.remaining,
    payments: b.payments.map((p) => ({ date: p.date, docNo: p.docNo, method: p.method, reference: p.reference, amount: p.amount })),
    charges: b.charges, words: b.words, notes: doc.remarks, printedBy: auth.user.name,
  });
  await prisma.accountingDocument.update({ where: { id: doc.id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
  const inline = request.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="Purchase-${doc.docNo.replace(/\//g, "-")}.pdf"`, "Cache-Control": "no-store" },
  });
}
