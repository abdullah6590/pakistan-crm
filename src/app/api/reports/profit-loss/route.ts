// src/app/api/reports/profit-loss/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateFinanceReport } from "@/lib/excel-generator";
import { generateTablePDF } from "@/lib/pdf-generator";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format") || "json";

  const where: any = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59.999Z");
  }

  const records = await prisma.finance.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true } } },
  });

  const totalIncome = records.filter(r => r.type === "INCOME").reduce((s, r) => s + r.amount, 0);
  const totalExpense = records.filter(r => r.type === "EXPENSE").reduce((s, r) => s + r.amount, 0);
  const netProfit = totalIncome - totalExpense;

  if (format === "excel") {
    const buffer = await generateFinanceReport(records.map(r => ({
      ref: r.transactionRef || r.id.slice(0, 8),
      type: r.type,
      category: r.category,
      description: r.description || "",
      amount: r.amount,
      date: r.createdAt.toISOString().slice(0, 10),
    })));
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=profit-loss-report.xlsx" },
    });
  }

  if (format === "pdf") {
    const buffer = await generateTablePDF(
      "Profit & Loss Report",
      ["Ref", "Type", "Category", "Description", "Amount", "Date"],
      records.map(r => [
        r.transactionRef || r.id.slice(0, 8), r.type, r.category, r.description || "", String(r.amount), r.createdAt.toISOString().slice(0, 10)
      ])
    );
    return new NextResponse(buffer as any, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=profit-loss-report.pdf" },
    });
  }

  return NextResponse.json({ totalIncome, totalExpense, netProfit, records: JSON.parse(JSON.stringify(records)) });
}