// src/app/api/sales/[id]/pdf/route.ts - The sale bill as a PDF file (Sales → bill → Download PDF). A Books bill shows its
// current version with every payment and what remains (Report 28 §5); a bill from before the move keeps its old layout.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { loadBill } from "@/lib/sales/bill-view";
import { generateSaleBillPDF } from "@/lib/pdf-generator";
import { formatDate } from "@/lib/utils";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { invoicePdf } from "@/lib/books-pdf";

const STATUS_LABEL: Record<string, string> = { PAID: "Paid", PARTIALLY_PAID: "Partially paid", UNPAID: "Unpaid", CANCELLED: "Cancelled" };

function pdfResponse(pdf: Buffer, name: string, inline: boolean) {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;

  const { id } = await params;
  const inline = request.nextUrl.searchParams.get("inline") === "1";
  const books = await loadBooksBill(prisma, id);
  if (books) {
    const { doc } = books;
    const pdf = await invoicePdf({
      business: { name: books.businessName, address: books.businessAddress },
      kind: doc.type as "SALE_INVOICE" | "CASH_SALE",
      docNo: doc.docNo,
      revisionNote: doc.revision > 0 ? `Revision R${doc.revision} of ${doc.docNo.split("/")[0]}` : null,
      cancelled: doc.status === "CANCELLED",
      date: doc.date,
      customer: books.customerName,
      phone: books.customerPhone,
      status: STATUS_LABEL[books.status] ?? books.status,
      lines: doc.lines.map((l) => ({ description: l.description ?? "", sku: l.component?.sku, quantity: l.quantity, unit: l.unit, loose: l.loose, unitPrice: l.unitPrice, amount: l.amount })),
      total: books.total, paid: books.paid, remaining: books.remaining,
      payments: books.payments.map((p) => ({ date: p.date, receiptNo: p.receiptNo, method: p.method, amount: p.amount })),
      words: books.words, notes: books.notes, printedBy: auth.user.name,
    });
    await prisma.accountingDocument.update({ where: { id: doc.id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
    return pdfResponse(pdf, `Bill-${doc.docNo}`, inline);
  }
  const bill = await loadBill(prisma, id);
  if (!bill) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  const { sale } = bill;
  const lastEdit = bill.edits.at(-1);

  const pdf = await generateSaleBillPDF({
    businessName: bill.businessName,
    businessAddress: bill.businessAddress,
    invoiceNumber: sale.invoiceNumber,
    date: formatDate(sale.createdAt),
    customerName: sale.customer?.name ?? sale.walkInName ?? "Walk-in customer",
    customerPhone: sale.customer?.phone,
    paymentMethod: sale.paymentMethod,
    paymentStatus: sale.paymentStatus,
    lines: sale.items.map((i) => ({ name: i.component.name, sku: i.component.sku, quantity: i.quantity, unitPrice: i.unitPrice, total: i.totalPrice })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    amountInWords: bill.words,
    notes: sale.notes,
    edited: lastEdit ? `Corrected on ${formatDate(lastEdit.at)} by ${lastEdit.by}` : null,
    printedBy: auth.user.name,
  });
  // "attachment" saves the file; ?inline=1 opens it in the browser's PDF viewer instead
  const disposition = request.nextUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="Bill-${sale.invoiceNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
