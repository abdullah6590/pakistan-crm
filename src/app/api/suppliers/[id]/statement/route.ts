// src/app/api/suppliers/[id]/statement/route.ts - A supplier's statement from Books (Report 30 §7), as data or as a PDF
// (`?format=pdf`, `&inline=1` to open it in the browser). Optional `from` and `to` (YYYY-MM-DD).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/accounting/server";
import { getSetting } from "@/lib/accounting/setup";
import { supplierStatement } from "@/lib/purchases/queries";
import { supplierStatementPdf } from "@/lib/books-pdf";
import { formatDate } from "@/lib/utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("suppliers", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const p = request.nextUrl.searchParams;
  const st = await supplierStatement(prisma, id, { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined });
  if (!st) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  if (p.get("format") !== "pdf") return NextResponse.json(serialize({ statement: st }));
  const [name, address] = await Promise.all([getSetting(prisma, "BUSINESS_NAME"), getSetting(prisma, "BUSINESS_ADDRESS")]);
  const pdf = await supplierStatementPdf({
    business: { name: name || "Paper Mill ERP", address: address || "" },
    supplier: st.supplier.name, supplierCode: st.partyCode ?? "-", phone: st.supplier.phone,
    period: st.from || st.to ? `${st.from ? formatDate(st.from) : "Start"} to ${st.to ? formatDate(st.to) : "today"}` : `All entries up to ${formatDate(new Date())}`,
    opening: st.opening, rows: st.rows, totalDebit: st.totalDebit, totalCredit: st.totalCredit, closing: st.closing, printedBy: auth.user.name,
  });
  const fileName = `Statement-${st.supplier.name.replace(/[^\w-]+/g, "_")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${p.get("inline") === "1" ? "inline" : "attachment"}; filename="${fileName}"`, "Cache-Control": "no-store" },
  });
}
