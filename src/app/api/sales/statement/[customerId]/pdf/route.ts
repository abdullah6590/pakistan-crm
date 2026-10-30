// src/app/api/sales/statement/[customerId]/pdf/route.ts - A customer statement as PDF (Report 28 §5): every bill,
// payment, refund and credit with a running balance; ?from=YYYY-MM-DD&to=YYYY-MM-DD for a period.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/accounting/setup";
import { customerStatement } from "@/lib/sales/statement";
import { statementPdf } from "@/lib/books-pdf";
import { formatDate } from "@/lib/utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const auth = await authorize("customers", "read");
  if (auth.response) return auth.response;
  const { customerId } = await params;
  const sp = request.nextUrl.searchParams;
  const st = await customerStatement(prisma, customerId, { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  if (!st) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  const [businessName, businessAddress] = await Promise.all([getSetting(prisma, "BUSINESS_NAME"), getSetting(prisma, "BUSINESS_ADDRESS")]);
  const period = st.from || st.to ? `${st.from ? formatDate(st.from) : "Start"} to ${st.to ? formatDate(st.to) : formatDate(new Date())}` : `All entries to ${formatDate(new Date())}`;
  const pdf = await statementPdf({
    business: { name: businessName || "Paper Mill ERP", address: businessAddress || "" },
    customer: st.customer.name, phone: st.customer.phone, period,
    opening: st.opening, rows: st.rows, totalDebit: st.totalDebit, totalCredit: st.totalCredit, closing: st.closing,
    printedBy: auth.user.name,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${sp.get("inline") === "1" ? "inline" : "attachment"}; filename="Statement-${st.customer.name.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
