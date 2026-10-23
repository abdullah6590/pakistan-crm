// src/app/api/sales/[id]/pdf/route.ts - The sale bill as a PDF file (Sales → bill → Download PDF).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { loadBill } from "@/lib/sales/bill-view";
import { generateSaleBillPDF } from "@/lib/pdf-generator";
import { formatDate } from "@/lib/utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;

  const { id } = await params;
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
