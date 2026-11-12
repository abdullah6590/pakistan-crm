// src/app/api/accounting/reports/export/route.ts - Books reports and ledgers as an Excel file (the same figures as the
// screen): trial balance, Profit & Loss, Balance Sheet, cash/bank book, party balances, daybook, stock position and an
// account ledger.
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountStatement, daybook, stockReport, trialBalance } from "@/lib/accounting/queries";
import { balanceSheet, profitAndLoss, type StatementGroup } from "@/lib/accounting/statements";
import { getSetting } from "@/lib/accounting/setup";
import { cashBook, partyBalances } from "@/lib/accounting/books-reports";
import { DOCUMENT_TYPES } from "@/lib/accounting/meta";

const RESOURCE: Record<string, string> = {
  "trial-balance": "ledgers", "profit-loss": "ledgers", "balance-sheet": "ledgers", "cash-book": "ledgers", "party-balances": "ledgers", daybook: "ledgers", stock: "inventory", ledger: "ledgers",
};
const MONEY = "#,##0.00;[Red]-#,##0.00";
const n = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const typeLabel = (t: string) => DOCUMENT_TYPES[t]?.title ?? t;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const report = sp.get("report") ?? "";
  const resource = RESOURCE[report];
  if (!resource) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  const auth = await authorize(resource, "read");
  if (auth.response) return auth.response;

  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const range = { from: from ? new Date(from) : undefined, to: to ? new Date(`${to}T23:59:59.999Z`) : undefined };
  const period = `${from ?? "Beginning"} to ${to ?? "today"}`;
  const business = (await getSetting(prisma, "BUSINESS_NAME")) || "Pakistan CRM";

  const wb = new ExcelJS.Workbook();
  wb.creator = business;
  const sheet = (title: string, sub: string, columns: { header: string; width: number; money?: boolean }[]) => {
    const ws = wb.addWorksheet(title.slice(0, 31));
    ws.addRow([business]).font = { bold: true, size: 14 };
    ws.addRow([title]).font = { bold: true, size: 12 };
    ws.addRow([sub]);
    ws.addRow([]);
    const head = ws.addRow(columns.map((c) => c.header));
    head.font = { bold: true };
    head.eachCell((c) => { c.border = { bottom: { style: "thin" } }; });
    columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; if (c.money) ws.getColumn(i + 1).numFmt = MONEY; });
    ws.views = [{ state: "frozen", ySplit: 5 }];
    return ws;
  };
  const bold = (row: ExcelJS.Row) => { row.font = { bold: true }; return row; };
  let name = report;

  if (report === "trial-balance") {
    const tb = await trialBalance(prisma, range.to);
    const ws = sheet("Trial balance", `As on ${to ?? "today"}`, [{ header: "Code", width: 22 }, { header: "Account", width: 36 }, { header: "Type", width: 14 }, { header: "Debit", width: 16, money: true }, { header: "Credit", width: 16, money: true }]);
    for (const r of tb.rows) ws.addRow([r.code, r.name, (r.subType ?? r.kind).toLowerCase(), n(r.debit), n(r.credit)]);
    bold(ws.addRow(["", tb.balanced ? "Total (balanced)" : "Total (NOT BALANCED)", "", n(tb.debitTotal), n(tb.creditTotal)]));
    name = `Trial-balance-${to ?? "today"}`;
  } else if (report === "profit-loss") {
    const pl = await profitAndLoss(prisma, range);
    const ws = sheet("Profit and loss", period, [{ header: "Account", width: 40 }, { header: "Amount", width: 18, money: true }]);
    const groupRows = (g: StatementGroup) => {
      bold(ws.addRow([g.title]));
      for (const l of g.lines) ws.addRow([`   ${l.name}`, n(l.amount)]);
      bold(ws.addRow([`Total ${g.title.toLowerCase()}`, n(g.total)]));
    };
    groupRows(pl.sales); groupRows(pl.cogs);
    bold(ws.addRow(["Gross profit", n(pl.grossProfit)]));
    ws.addRow([]);
    groupRows(pl.otherIncome); groupRows(pl.expenses);
    bold(ws.addRow(["Net profit", n(pl.netProfit)])).font = { bold: true, size: 12 };
    name = `Profit-and-loss-${from ?? "start"}-to-${to ?? "today"}`;
  } else if (report === "balance-sheet") {
    const bs = await balanceSheet(prisma, range.to);
    const ws = sheet("Balance sheet", `As on ${to ?? "today"}${bs.balanced ? "" : " (NOT BALANCED)"}`, [{ header: "", width: 44 }, { header: "Amount", width: 18, money: true }]);
    const side = (title: string, groups: StatementGroup[], total: string) => {
      bold(ws.addRow([title])).font = { bold: true, size: 12 };
      for (const g of groups) {
        bold(ws.addRow([g.title]));
        for (const l of g.lines) ws.addRow([`   ${l.name}`, n(l.amount)]);
        ws.addRow([`   Total ${g.title.toLowerCase()}`, n(g.total)]);
      }
      bold(ws.addRow([`Total ${title.toLowerCase()}`, n(total)]));
      ws.addRow([]);
    };
    side("Assets", bs.assets, bs.assetsTotal);
    side("Liabilities", bs.liabilities, bs.liabilitiesTotal);
    bold(ws.addRow(["Owner's equity"])).font = { bold: true, size: 12 };
    for (const l of bs.equity.lines) ws.addRow([`   ${l.name}`, n(l.amount)]);
    ws.addRow(["   Profit to date", n(bs.profitToDate)]);
    bold(ws.addRow(["Total owner's equity", n(bs.equityTotal)]));
    name = `Balance-sheet-${to ?? "today"}`;
  } else if (report === "cash-book") {
    const accountId = sp.get("account") ?? (await prisma.ledgerAccount.findFirst({ where: { kind: "CASH_BANK" }, orderBy: [{ subType: "desc" }, { name: "asc" }] }))?.id;
    const book = accountId ? await cashBook(prisma, accountId, range) : null;
    if (!book) return NextResponse.json({ error: "Choose a cash or bank account" }, { status: 400 });
    const ws = sheet(`${book.account.subType === "BANK" ? "Bank" : "Cash"} book`, `${book.account.name} · ${period}`, [{ header: "Date", width: 12 }, { header: "Ref", width: 16 }, { header: "Received from / paid to", width: 40 }, { header: "In", width: 16, money: true }, { header: "Out", width: 16, money: true }, { header: "Balance", width: 18, money: true }]);
    ws.addRow([from ? new Date(from) : null, "Opn", "Opening balance (B/F)", null, null, n(book.opening)]);
    for (const d of book.days) {
      d.entries.forEach((e, j) => ws.addRow([j === 0 ? new Date(d.date) : null, `${e.docNo}${e.reversal ? " (cancelled)" : ""}`, e.remarks ? `${e.particulars} · ${e.remarks}` : e.particulars, n(e.in), n(e.out), null]));
      ws.addRow([null, "", "Day total and closing balance", n(d.in), n(d.out), n(d.closing)]).font = { italic: true };
    }
    ws.getColumn(1).numFmt = "dd/mm/yyyy";
    bold(ws.addRow(["", "", "Total and closing balance", n(book.totalIn), n(book.totalOut), n(book.closing)]));
    name = `${book.account.subType === "BANK" ? "Bank" : "Cash"}-book-${from ?? "start"}-to-${to ?? "today"}`;
  } else if (report === "party-balances") {
    const typeParam = sp.get("type");
    const type = typeParam === "CUSTOMER" || typeParam === "SUPPLIER" ? typeParam : "ALL";
    const minimum = Number(sp.get("min")) > 0 ? Number(sp.get("min")) : 0;
    const pb = await partyBalances(prisma, { type, minimum, asOf: range.to });
    const ws = sheet("Party balances", `As on ${to ?? "today"}${minimum ? `, more than Rs ${minimum}` : ""}`, [{ header: "Name", width: 36 }, { header: "Phone", width: 16 }, { header: "Type", width: 12 }, { header: "Owes you", width: 16, money: true }, { header: "You owe", width: 16, money: true }]);
    for (const r of pb.rows) {
      const owes = !r.balance.startsWith("-");
      ws.addRow([r.name, r.phone ?? "", (r.type ?? "").toLowerCase(), owes ? n(r.balance) : null, owes ? null : n(r.balance.slice(1))]);
    }
    bold(ws.addRow([`Total (${pb.rows.length})`, "", "", n(pb.owedToYou), n(pb.youOwe)]));
    name = `Party-balances-${to ?? "today"}`;
  } else if (report === "daybook") {
    const db = await daybook(prisma, range);
    const ws = sheet("Daybook", period, [{ header: "Date", width: 12 }, { header: "Document", width: 16 }, { header: "Type", width: 20 }, { header: "Account", width: 32 }, { header: "Debit", width: 16, money: true }, { header: "Credit", width: 16, money: true }, { header: "Remarks", width: 36 }]);
    for (const r of db.rows) r.lines.forEach((l, j) => ws.addRow([
      j === 0 ? new Date(r.date) : null, j === 0 ? `${r.docNo}${r.kind === "REVERSAL" ? " (reversal)" : ""}` : "", j === 0 ? typeLabel(r.type) : "", l.name, n(l.debit), n(l.credit), j === 0 ? r.remarks ?? "" : l.memo ?? "",
    ]));
    ws.getColumn(1).numFmt = "dd/mm/yyyy";
    bold(ws.addRow(["", "", "", "Total", n(db.debitTotal), n(db.creditTotal)]));
    name = `Daybook-${from ?? "start"}-to-${to ?? "today"}`;
  } else if (report === "stock") {
    const st = await stockReport(prisma, { locationCode: sp.get("location") ?? undefined });
    const ws = sheet("Stock position", `On ${new Date().toISOString().slice(0, 10)}`, [{ header: "SKU", width: 18 }, { header: "Item", width: 36 }, { header: "Packs", width: 10 }, { header: "Pack", width: 10 }, { header: "Loose", width: 10 }, { header: "On hand", width: 14 }, { header: "Unit", width: 10 }, { header: "Total kg", width: 12 }, { header: "Average cost", width: 16, money: true }, { header: "Value", width: 18, money: true }]);
    for (const r of st.rows) ws.addRow([r.sku, r.name, r.packs ? n(r.packs.packs) : null, r.packs?.unit ?? "", r.packs ? n(r.packs.loose) : null, n(r.onHand), r.baseUnit, r.weightKg, n(r.averageCost), n(r.value)]);
    bold(ws.addRow(["", "Total value", null, "", null, null, "", null, null, n(st.totalValue)]));
    name = "Stock-position";
  } else {
    const accountId = sp.get("account");
    const st = accountId ? await accountStatement(prisma, accountId, range) : null;
    if (!st) return NextResponse.json({ error: "Choose an account" }, { status: 400 });
    const ws = sheet(`Ledger ${st.account.name}`, `${st.account.code} ${st.account.name} · ${period}`, [{ header: "Date", width: 12 }, { header: "Ref", width: 16 }, { header: "Particulars", width: 44 }, { header: "Debit", width: 16, money: true }, { header: "Credit", width: 16, money: true }, { header: "Balance", width: 18, money: true }]);
    ws.addRow([from ? new Date(from) : null, "Opn", "Opening balance (B/F)", null, null, n(st.opening)]);
    for (const r of st.rows) {
      const label = r.entryKind === "REVERSAL" ? `Cancelled: ${r.memo ?? ""}` : r.items.length ? r.items.map((i) => `${i.description} ${i.quantity}${i.unit ? ` ${i.unit}` : ""}`).join("; ") : r.remarks ?? r.memo ?? "";
      ws.addRow([new Date(r.date), r.docNo, label, n(r.debit), n(r.credit), n(r.balance)]);
    }
    ws.getColumn(1).numFmt = "dd/mm/yyyy";
    bold(ws.addRow(["", "", "Total / closing balance (debit positive)", n(st.totalDebit), n(st.totalCredit), n(st.closing)]));
    name = `Ledger-${st.account.code}-${from ?? "start"}-to-${to ?? "today"}`;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "-")}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
