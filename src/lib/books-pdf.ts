// src/lib/books-pdf.ts - PDFs of Sales on Books (Report 28 §5): the current version of an invoice with its payments,
// a receipt for each payment, and a customer statement. Positions are set explicitly so long names wrap inside their
// column; tables continue on a new page with their heading repeated.
import PDFDocument from "pdfkit";
import { formatCurrency, formatDate, formatPaisa } from "./utils";
import { quantityLabel } from "./domain/units";

type Doc = InstanceType<typeof PDFDocument>;
const LEFT = 40;
const RIGHT = 555;
const WIDTH = RIGHT - LEFT;
const BOTTOM = 770;
const rs = (v: string | number) => formatCurrency(Number(v));

function render(title: string, draw: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}

function heading(doc: Doc, business: { name: string; address?: string }, title: string, sub?: string | null) {
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000").text(business.name, LEFT, 40, { width: WIDTH, align: "center" });
  if (business.address) doc.font("Helvetica").fontSize(9).text(business.address, { width: WIDTH, align: "center" });
  doc.moveDown(0.4).font("Helvetica-Bold").fontSize(12).text(title.toUpperCase(), { width: WIDTH, align: "center" });
  if (sub) doc.font("Helvetica").fontSize(9).text(sub, { width: WIDTH, align: "center" });
  return doc.y + 12;
}

/** Two facts per line: label/value on the left, label/value on the right. */
function facts(doc: Doc, y: number, pairs: [string, string][]) {
  doc.font("Helvetica").fontSize(10);
  for (let i = 0; i < pairs.length; i += 2) {
    doc.text(pairs[i][1] ? `${pairs[i][0]}: ${pairs[i][1]}` : "", LEFT, y, { width: WIDTH / 2 + 40 });
    if (pairs[i + 1]) doc.text(`${pairs[i + 1][0]}: ${pairs[i + 1][1]}`, LEFT, y, { width: WIDTH, align: "right" });
    y += 15;
  }
  return y + 4;
}

interface Column { title: string; width: number; align?: "left" | "right" }

/** A table that continues on new pages with its heading repeated. Returns the y after it. */
function table(doc: Doc, y: number, cols: Column[], rows: string[][], opts: { boldLast?: boolean } = {}) {
  const head = () => {
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1).stroke("#000000");
    doc.font("Helvetica-Bold").fontSize(9);
    let x = LEFT;
    for (const c of cols) { doc.text(c.title, x + 2, y + 4, { width: c.width - 4, align: c.align ?? "left" }); x += c.width; }
    y += 18;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).stroke("#000000");
    y += 4;
  };
  head();
  rows.forEach((r, i) => {
    const bold = opts.boldLast && i === rows.length - 1;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    const h = Math.max(...r.map((cell, j) => doc.heightOfString(cell, { width: cols[j].width - 4 })), 11) + 6;
    if (y + h > BOTTOM) { doc.addPage(); y = 40; head(); doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9); }
    let x = LEFT;
    r.forEach((cell, j) => { doc.text(cell, x + 2, y, { width: cols[j].width - 4, align: cols[j].align ?? "left" }); x += cols[j].width; });
    y += h;
    doc.moveTo(LEFT, y - 3).lineTo(RIGHT, y - 3).dash(1, { space: 2 }).stroke("#9CA3AF").undash();
  });
  return y + 6;
}

function totalsBlock(doc: Doc, y: number, rowsOf: [string, string, boolean?][]) {
  if (y + rowsOf.length * 16 > BOTTOM) { doc.addPage(); y = 40; }
  for (const [label, value, bold] of rowsOf) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10);
    doc.text(label, 330, y, { width: 130 });
    doc.text(value, 460, y, { width: RIGHT - 460, align: "right" });
    y += bold ? 18 : 15;
  }
  return y;
}

function footer(doc: Doc, y: number, lines: (string | null | undefined)[], printedBy: string) {
  doc.font("Helvetica").fontSize(9).fillColor("#000000");
  for (const l of lines.filter(Boolean) as string[]) { doc.text(l, LEFT, y, { width: WIDTH }); y = doc.y + 2; }
  doc.moveDown(2).fontSize(8).fillColor("#6B7280").text(`Printed by ${printedBy} on ${formatDate(new Date())}`, LEFT, doc.y, { width: WIDTH, align: "center" });
}

export interface InvoicePdf {
  business: { name: string; address?: string };
  kind: "SALE_INVOICE" | "CASH_SALE";
  docNo: string;
  revisionNote: string | null;
  cancelled: boolean;
  date: string | Date;
  customer: string;
  phone?: string | null;
  status: string;
  lines: { description: string; sku?: string | null; quantity: string; unit?: string | null; loose?: string | null; unitPrice: string | null; amount: string | null }[];
  total: string;
  paid: string;
  remaining: string;
  payments: { date: string | Date; receiptNo: string; method: string; amount: string }[];
  words: string;
  notes?: string | null;
  printedBy: string;
}

export function invoicePdf(b: InvoicePdf) {
  return render(`Bill ${b.docNo}`, (doc) => {
    let y = heading(doc, b.business, b.kind === "SALE_INVOICE" ? "Sale invoice" : "Cash sale", [b.revisionNote, b.cancelled ? "CANCELLED" : null].filter(Boolean).join(" · ") || null);
    y = facts(doc, y, [["Bill No", b.docNo], ["Date", formatDate(b.date)], ["Customer", `${b.customer}${b.phone ? ` (${b.phone})` : ""}`], ["Status", b.status]]);
    y = table(doc, y, [
      { title: "S.No", width: 30 }, { title: "Item", width: 215 }, { title: "Qty", width: 100, align: "right" }, { title: "Rate", width: 85, align: "right" }, { title: "Amount", width: 85, align: "right" },
    ], b.lines.map((l, i) => [String(i + 1), l.sku ? `${l.description}  (${l.sku})` : l.description, quantityLabel(l.quantity, l.unit, l.loose), rs(l.unitPrice ?? 0), rs(l.amount ?? 0)]));
    y = totalsBlock(doc, y, [["Invoice total", rs(b.total), true]]);
    if (b.payments.length) {
      doc.font("Helvetica-Bold").fontSize(10).text("Payments received", LEFT, y + 4);
      y = table(doc, doc.y + 4, [
        { title: "Date", width: 90 }, { title: "Receipt", width: 120 }, { title: "Method", width: 175 }, { title: "Amount", width: 130, align: "right" },
      ], b.payments.map((p) => [formatDate(p.date), p.receiptNo, p.method, rs(p.amount)]));
    }
    y = totalsBlock(doc, y, [["Received", rs(b.paid)], ["Amount remaining", rs(b.remaining), true]]);
    footer(doc, y + 6, [`Amount in words: ${b.words}`, b.notes ? `Notes: ${b.notes}` : null], b.printedBy);
  });
}

export interface ReceiptPdf {
  business: { name: string; address?: string };
  receiptNo: string;
  cancelled: boolean;
  date: string | Date;
  customer: string;
  method: string;
  amount: string;
  words: string;
  appliedTo: { docNo: string; amount: string }[];
  refunded: string;
  unapplied: string;
  remarks?: string | null;
  printedBy: string;
}

export function receiptPdf(r: ReceiptPdf) {
  return render(`Receipt ${r.receiptNo}`, (doc) => {
    let y = heading(doc, r.business, "Payment receipt", r.cancelled ? "CANCELLED" : null);
    y = facts(doc, y, [["Receipt No", r.receiptNo], ["Date", formatDate(r.date)], ["Received from", r.customer], ["Method", r.method]]);
    doc.font("Helvetica-Bold").fontSize(14).text(`Amount received: ${rs(r.amount)}`, LEFT, y + 4, { width: WIDTH });
    doc.font("Helvetica").fontSize(10).text(`(${r.words})`, LEFT, doc.y + 2, { width: WIDTH });
    y = doc.y + 12;
    if (r.appliedTo.length) {
      y = table(doc, y, [{ title: "For bill", width: 300 }, { title: "Amount", width: 215, align: "right" }], r.appliedTo.map((a) => [a.docNo, rs(a.amount)]));
    }
    const extra: [string, string, boolean?][] = [];
    if (Number(r.refunded) > 0) extra.push(["Refunded", rs(r.refunded)]);
    if (Number(r.unapplied) > 0) extra.push(["Kept as credit", rs(r.unapplied), true]);
    if (extra.length) y = totalsBlock(doc, y, extra);
    footer(doc, y + 6, [r.remarks ? `Remarks: ${r.remarks}` : null], r.printedBy);
    doc.font("Helvetica").fontSize(10).fillColor("#000000").text("Received by: ______________________", LEFT, Math.min(doc.y + 30, BOTTOM), { width: WIDTH, align: "right" });
  });
}

export interface StatementPdf {
  business: { name: string; address?: string };
  customer: string;
  phone?: string | null;
  period: string;
  opening: string;
  rows: { date: string; docNo: string; kind: string; debit: string; credit: string; balance: string; remaining?: string }[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
  printedBy: string;
}

const signed = (v: string) => (Number(v) < 0 ? `${rs(-Number(v))} Cr` : rs(v));

export function statementPdf(st: StatementPdf) {
  return render(`Statement ${st.customer}`, (doc) => {
    let y = heading(doc, st.business, "Customer statement", st.period);
    y = facts(doc, y, [["Customer", `${st.customer}${st.phone ? ` (${st.phone})` : ""}`], ["Opening balance", signed(st.opening)]]);
    y = table(doc, y, [
      { title: "Date", width: 70 }, { title: "Document", width: 95 }, { title: "Details", width: 110 },
      { title: "Debit", width: 80, align: "right" }, { title: "Credit", width: 80, align: "right" }, { title: "Balance", width: 80, align: "right" },
    ], [
      ...st.rows.map((r) => [
        formatDate(r.date), r.docNo, r.remaining !== undefined && Number(r.remaining) > 0 ? `${r.kind} (owes ${rs(r.remaining)})` : r.kind,
        Number(r.debit) ? rs(r.debit) : "", Number(r.credit) ? rs(r.credit) : "", signed(r.balance),
      ]),
      ["", "", "Totals", rs(st.totalDebit), rs(st.totalCredit), signed(st.closing)],
    ], { boldLast: true });
    y = totalsBlock(doc, y, [[Number(st.closing) >= 0 ? "Amount due" : "Credit in customer's favour", rs(Math.abs(Number(st.closing))), true]]);
    footer(doc, y + 6, ["Debit: bills charged to the customer. Credit: payments and returns. Cr: in the customer's favour."], st.printedBy);
  });
}

// ─── Purchases on Books (Report 30) ────────────────────────────────

/** Purchase money keeps paisa (Report 13), so these documents show 2 decimals where there are any. */
const rp = (v: string | number) => formatPaisa(v);

export interface PurchaseBillPdf {
  business: { name: string; address?: string };
  docNo: string;
  revisionNote: string | null;
  cancelled: boolean;
  date: string | Date;
  supplier: string;
  supplierCode: string;
  supplierPhone?: string | null;
  vendorBillNo?: string | null;
  vendorBillDate?: string | Date | null;
  dueDate?: string | Date | null;
  biltyNo?: string | null;
  status: string;
  lines: { description: string; sku?: string | null; quantity: string; unit?: string | null; loose?: string | null; unitPrice: string | null; amount: string | null }[];
  total: string;
  paid: string;
  returned: string;
  remaining: string;
  payments: { date: string | Date; docNo: string; method: string; reference?: string | null; amount: string }[];
  charges: { kind: string; description: string; amount: string; status: string }[];
  words: string;
  notes?: string | null;
  printedBy: string;
}

export function purchaseBillPdf(b: PurchaseBillPdf) {
  return render(`Purchase bill ${b.docNo}`, (doc) => {
    let y = heading(doc, b.business, "Purchase bill", [b.revisionNote, b.cancelled ? "CANCELLED" : null].filter(Boolean).join(" · ") || null);
    const vendor = b.vendorBillNo ? `${b.vendorBillNo}${b.vendorBillDate ? ` of ${formatDate(b.vendorBillDate)}` : ""}` : "-";
    y = facts(doc, y, [
      ["Bill No", b.docNo], ["Date", formatDate(b.date)],
      ["Supplier", `${b.supplier} (${b.supplierCode})${b.supplierPhone ? `, ${b.supplierPhone}` : ""}`], ["Status", b.status],
      ["Supplier bill", vendor], ["Due date", b.dueDate ? formatDate(b.dueDate) : "-"],
      ...(b.biltyNo ? [["Bilty", b.biltyNo] as [string, string]] : []),
    ]);
    y = table(doc, y, [
      { title: "S.No", width: 30 }, { title: "Item", width: 215 }, { title: "Qty", width: 100, align: "right" }, { title: "Rate", width: 85, align: "right" }, { title: "Amount", width: 85, align: "right" },
    ], b.lines.map((l, i) => [String(i + 1), l.sku ? `${l.description}  (${l.sku})` : l.description, quantityLabel(l.quantity, l.unit, l.loose), rp(l.unitPrice ?? 0), rp(l.amount ?? 0)]));
    y = totalsBlock(doc, y, [["Bill total", rp(b.total), true]]);
    if (b.payments.length) {
      doc.font("Helvetica-Bold").fontSize(10).text("Paid and returned against this bill", LEFT, y + 4);
      y = table(doc, doc.y + 4, [
        { title: "Date", width: 80 }, { title: "Document", width: 100 }, { title: "Method", width: 150 }, { title: "Reference", width: 95 }, { title: "Amount", width: 90, align: "right" },
      ], b.payments.map((p) => [formatDate(p.date), p.docNo, p.method, p.reference ?? "", rp(p.amount)]));
    }
    const sums: [string, string, boolean?][] = [["Paid", rp(b.paid)]];
    if (Number(b.returned) > 0) sums.push(["Goods returned", rp(b.returned)]);
    sums.push(["Still payable", rp(b.remaining), true]);
    y = totalsBlock(doc, y, sums);
    if (b.charges.length) {
      doc.font("Helvetica-Bold").fontSize(10).text("Charges recorded with this bill (not in the bill total or item cost)", LEFT, y + 6);
      y = table(doc, doc.y + 4, [{ title: "Charge", width: 120 }, { title: "Details", width: 245 }, { title: "Status", width: 70 }, { title: "Amount", width: 80, align: "right" }],
        b.charges.map((c) => [c.kind, c.description, c.status.toLowerCase(), rp(c.amount)]));
    }
    footer(doc, y + 6, [`Amount in words: ${b.words}`, b.notes ? `Notes: ${b.notes}` : null], b.printedBy);
  });
}

export interface PaymentVoucherPdf {
  business: { name: string; address?: string };
  docNo: string;
  kind: "PAYMENT" | "REFUND_RECEIVED";
  cancelled: boolean;
  date: string | Date;
  supplier: string;
  supplierCode: string;
  account: string;
  reference?: string | null;
  amount: string;
  words: string;
  bills: { docNo: string; vendorBillNo?: string | null; amount: string }[];
  unapplied: string;
  remarks?: string | null;
  printedBy: string;
}

export function paymentVoucherPdf(v: PaymentVoucherPdf) {
  const refund = v.kind === "REFUND_RECEIVED";
  return render(`${refund ? "Receipt" : "Payment voucher"} ${v.docNo}`, (doc) => {
    let y = heading(doc, v.business, refund ? "Refund received from supplier" : "Payment voucher", v.cancelled ? "CANCELLED" : null);
    y = facts(doc, y, [
      ["Voucher No", v.docNo], ["Date", formatDate(v.date)],
      [refund ? "Received from" : "Paid to", `${v.supplier} (${v.supplierCode})`], [refund ? "Into" : "From", v.account],
      ["Reference", v.reference || "-"],
    ]);
    doc.font("Helvetica-Bold").fontSize(14).text(`${refund ? "Amount received" : "Amount paid"}: ${rp(v.amount)}`, LEFT, y + 4, { width: WIDTH });
    doc.font("Helvetica").fontSize(10).text(`(${v.words})`, LEFT, doc.y + 2, { width: WIDTH });
    y = doc.y + 12;
    if (v.bills.length) {
      y = table(doc, y, [{ title: "For bill", width: 160 }, { title: "Supplier bill", width: 160 }, { title: "Amount", width: 195, align: "right" }],
        v.bills.map((b) => [b.docNo, b.vendorBillNo ?? "", rp(b.amount)]));
    }
    if (Number(v.unapplied) > 0) y = totalsBlock(doc, y, [["Advance (not yet against a bill)", rp(v.unapplied), true]]);
    footer(doc, y + 6, [v.remarks ? `Remarks: ${v.remarks}` : null], v.printedBy);
    doc.font("Helvetica").fontSize(10).fillColor("#000000")
      .text("Prepared by: ________________     Approved by: ________________     Received by: ________________", LEFT, Math.min(doc.y + 30, BOTTOM), { width: WIDTH });
  });
}

export interface SupplierStatementPdf {
  business: { name: string; address?: string };
  supplier: string;
  supplierCode: string;
  phone?: string | null;
  period: string;
  opening: string;
  rows: { date: string; docNo: string; kind: string; reference: string | null; debit: string; credit: string; balance: string; remaining?: string }[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
  printedBy: string;
}

/** Positive: owed to the supplier; "Dr": the supplier owes the business. */
const owedTo = (v: string) => (Number(v) < 0 ? `${rp(-Number(v))} Dr` : rp(v));

export function supplierStatementPdf(st: SupplierStatementPdf) {
  return render(`Statement ${st.supplier}`, (doc) => {
    let y = heading(doc, st.business, "Supplier statement", st.period);
    y = facts(doc, y, [["Supplier", `${st.supplier} (${st.supplierCode})${st.phone ? `, ${st.phone}` : ""}`], ["Opening balance", owedTo(st.opening)]]);
    y = table(doc, y, [
      { title: "Date", width: 62 }, { title: "Document", width: 80 }, { title: "Details", width: 135 },
      { title: "Debit", width: 78, align: "right" }, { title: "Credit", width: 78, align: "right" }, { title: "Balance", width: 82, align: "right" },
    ], [
      ...st.rows.map((r) => [
        formatDate(r.date), r.docNo,
        `${r.kind}${r.reference ? ` (${r.reference})` : ""}${r.remaining !== undefined && Number(r.remaining) > 0 ? `, payable ${rp(r.remaining)}` : ""}`,
        Number(r.debit) ? rp(r.debit) : "", Number(r.credit) ? rp(r.credit) : "", owedTo(r.balance),
      ]),
      ["", "", "Totals", rp(st.totalDebit), rp(st.totalCredit), owedTo(st.closing)],
    ], { boldLast: true });
    y = totalsBlock(doc, y, [[Number(st.closing) >= 0 ? "Payable to supplier" : "Supplier owes us", rp(Math.abs(Number(st.closing))), true]]);
    footer(doc, y + 6, ["Credit: purchase bills and refunds received from the supplier. Debit: payments and goods returned. Dr: the supplier owes the business."], st.printedBy);
  });
}
