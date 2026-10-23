// src/lib/pdf-generator.ts - PDF report & invoice generation
import PDFDocument from 'pdfkit';
import type { SaleData, ProjectData, InvoiceData } from '@/types';
import { formatCurrency, formatDate } from './utils';

// ─── Generate Sale Invoice PDF ──────────────────────────────────────
export async function generateInvoicePDF(invoice: InvoiceData): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', { align: 'right' });
    doc.fontSize(10).font('Helvetica').text(`# ${invoice.invoiceNumber}`, { align: 'right' });
    doc.moveDown();

    // Company Info
    doc.fontSize(14).font('Helvetica-Bold').text('Paper Mill ERP');
    doc.fontSize(9).font('Helvetica')
      .text('Paper & Packaging Solutions')
      .text('Pakistan')
      .moveDown();

    // Customer Info
    doc.fontSize(10).font('Helvetica-Bold').text('Bill To:');
    doc.fontSize(9).font('Helvetica')
      .text(invoice.customerName)
      .text(invoice.customerPhone || '')
      .text(invoice.customerEmail || '')
      .moveDown();

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E5E7EB');
    doc.moveDown(0.5);

    // Table Header
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Description', 50, tableTop, { width: 250 });
    doc.text('Qty', 310, tableTop, { width: 50, align: 'center' });
    doc.text('Unit Price', 370, tableTop, { width: 80, align: 'right' });
    doc.text('Total', 460, tableTop, { width: 80, align: 'right' });
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E5E7EB');
    doc.moveDown(0.5);

    // Table Body
    doc.font('Helvetica');
    let yPos = doc.y;
    for (const item of invoice.items) {
      doc.text(item.description, 50, yPos, { width: 250 });
      doc.text(String(item.quantity), 310, yPos, { width: 50, align: 'center' });
      doc.text(formatCurrency(item.unitPrice), 370, yPos, { width: 80, align: 'right' });
      doc.text(formatCurrency(item.total), 460, yPos, { width: 80, align: 'right' });
      yPos += 18;
      
      if (yPos > 700) {
        doc.addPage();
        yPos = 50;
      }
    }

    // Totals
    doc.moveDown(1);
    const rightCol = 370;
    doc.font('Helvetica');
    doc.text('Subtotal:', rightCol, doc.y, { width: 80 });
    doc.text(formatCurrency(invoice.subtotal), 460, doc.y - 12, { width: 80, align: 'right' });
    
    if (invoice.discount > 0) {
      doc.text('Discount:', rightCol, doc.y, { width: 80 });
      doc.text(formatCurrency(invoice.discount), 460, doc.y - 12, { width: 80, align: 'right' });
    }
    
    if (invoice.tax > 0) {
      doc.text('Tax:', rightCol, doc.y, { width: 80 });
      doc.text(formatCurrency(invoice.tax), 460, doc.y - 12, { width: 80, align: 'right' });
    }
    
    doc.moveTo(rightCol, doc.y).lineTo(545, doc.y).stroke('#E5E7EB');
    doc.font('Helvetica-Bold');
    doc.text('TOTAL:', rightCol, doc.y + 5, { width: 80 });
    doc.text(formatCurrency(invoice.total), 460, doc.y - 7, { width: 80, align: 'right' });

    // Footer
    doc.moveDown(3);
    doc.fontSize(8).font('Helvetica').fillColor('#9CA3AF')
      .text('Thank you for your business!', { align: 'center' })
      .text(`Generated on ${formatDate(new Date())}`, { align: 'center' });

    doc.end();
  });
}

// ─── Generate Project Report PDF ────────────────────────────────────
export async function generateProjectReport(project: ProjectData, components: Array<{ name: string; quantity: number; totalCost: number }>): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).font('Helvetica-Bold').text('PROJECT REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(project.name, { align: 'center' });
    doc.moveDown();

    // Project Details
    doc.fontSize(9).font('Helvetica');
    const details = [
      ['Project ID', project.projectId],
      ['Client', project.clientName || 'N/A'],
      ['Status', project.status],
      ['Start Date', formatDate(project.startDate)],
      ['Deadline', project.deadline ? formatDate(project.deadline) : 'N/A'],
      ['Labor Cost', formatCurrency(project.laborCost)],
      ['Other Costs', formatCurrency(project.otherCosts)],
      ['Total Cost', formatCurrency(project.totalCost)],
      ['Client Payment', formatCurrency(project.clientPayment)],
      ['Remaining', formatCurrency(project.remainingPayment)],
      ['Profit/Loss', formatCurrency(project.profit)],
    ];

    for (const [label, value] of details) {
      doc.font('Helvetica-Bold').text(`${label}:`, 50, doc.y + 2, { continued: true, width: 150 });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown();

    // Components Table
    if (components.length > 0) {
      doc.fontSize(11).font('Helvetica-Bold').text('Components Used');
      doc.moveDown(0.5);
      
      doc.fontSize(9);
      doc.text('Component', 50, doc.y, { width: 250 });
      doc.text('Qty', 320, doc.y - 12, { width: 60, align: 'center' });
      doc.text('Cost', 400, doc.y - 12, { width: 80, align: 'right' });
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E5E7EB');
      doc.moveDown(0.5);

      for (const comp of components) {
        doc.font('Helvetica').text(comp.name, 50, doc.y, { width: 250 });
        doc.text(String(comp.quantity), 320, doc.y - 12, { width: 60, align: 'center' });
        doc.text(formatCurrency(comp.totalCost), 400, doc.y - 12, { width: 80, align: 'right' });
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#9CA3AF').text(`Generated: ${formatDate(new Date())}`, { align: 'center' });

    doc.end();
  });
}

// ─── Generate Financial Summary PDF ─────────────────────────────────
export async function generateFinancialReport(summary: {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  monthlyData: Array<{ month: string; income: number; expense: number }>;
}): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).font('Helvetica-Bold').text('FINANCIAL REPORT', { align: 'center' });
    doc.moveDown();

    // Summary Cards
    doc.fontSize(10);
    doc.font('Helvetica-Bold').text('Total Income:', 50, doc.y, { continued: true });
    doc.fillColor('#10B981').font('Helvetica').text(`  ${formatCurrency(summary.totalIncome)}`);
    doc.fillColor('black');
    
    doc.font('Helvetica-Bold').text('Total Expenses:', 50, doc.y, { continued: true });
    doc.fillColor('#EF4444').font('Helvetica').text(`  ${formatCurrency(summary.totalExpenses)}`);
    doc.fillColor('black');
    
    doc.font('Helvetica-Bold').text('Net Profit:', 50, doc.y, { continued: true });
    const profitColor = summary.netProfit >= 0 ? '#10B981' : '#EF4444';
    doc.fillColor(profitColor).font('Helvetica').text(`  ${formatCurrency(summary.netProfit)}`);
    doc.fillColor('black');
    doc.moveDown();

    // Monthly Table
    doc.fontSize(11).font('Helvetica-Bold').text('Monthly Breakdown');
    doc.moveDown(0.3);

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Month', 50, doc.y, { width: 100 });
    doc.text('Income', 180, doc.y - 12, { width: 120, align: 'right' });
    doc.text('Expense', 320, doc.y - 12, { width: 120, align: 'right' });
    doc.text('Net', 460, doc.y - 12, { width: 80, align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E5E7EB');
    doc.moveDown(0.5);

    for (const month of summary.monthlyData) {
      doc.font('Helvetica').text(month.month, 50, doc.y, { width: 100 });
      doc.text(formatCurrency(month.income), 180, doc.y - 12, { width: 120, align: 'right' });
      doc.text(formatCurrency(month.expense), 320, doc.y - 12, { width: 120, align: 'right' });
      const net = month.income - month.expense;
      doc.text(formatCurrency(net), 460, doc.y - 12, { width: 80, align: 'right' });
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#9CA3AF').text(`Generated: ${formatDate(new Date())}`, { align: 'center' });

    doc.end();
  });
}

export async function generateTablePDF(title: string, headers: string[], rows: string[][]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // Header
    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(9).font('Helvetica').text('Paper Mill ERP - Generated on ' + new Date().toLocaleDateString(), { align: 'center' });
    doc.moveDown(2);

    const startX = 40;
    let currentY = doc.y;
    
    // Auto column widths
    const colWidth = (595 - 80) / headers.length;

    // Draw headers
    doc.font('Helvetica-Bold').fontSize(9);
    headers.forEach((h, i) => {
      doc.text(h, startX + (i * colWidth), currentY, { width: colWidth, align: 'left' });
    });
    currentY += 15;
    doc.moveTo(startX, currentY).lineTo(555, currentY).stroke('#E5E7EB');
    currentY += 10;

    // Draw rows
    doc.font('Helvetica').fontSize(8);
    for (const row of rows) {
      if (currentY > 750) {
        doc.addPage();
        currentY = 40;
      }
      row.forEach((cell, i) => {
        doc.text(String(cell || ''), startX + (i * colWidth), currentY, { width: colWidth - 5, align: 'left' });
      });
      currentY += 15;
    }
    
    doc.end();
  });
}

// ─── Sale bill PDF (Sales → bill → Download PDF) ────────────────────
export interface SaleBillPdf {
  businessName: string;
  businessAddress?: string;
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerPhone?: string | null;
  paymentMethod: string;
  paymentStatus: string;
  lines: { name: string; sku: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amountInWords: string;
  notes?: string | null;
  edited?: string | null;
  printedBy: string;
}

/** One A4 bill. Every position is set explicitly, so long item names wrap inside their column and pages break
 *  cleanly; the heading of the item table is repeated on each page. */
export async function generateSaleBillPDF(bill: SaleBillPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Bill ${bill.invoiceNumber}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40, right = 555, width = right - left;
    const col = { no: left, item: left + 28, qty: 330, rate: 395, amount: 475 };
    const money = (n: number) => formatCurrency(n);

    doc.font('Helvetica-Bold').fontSize(16).text(bill.businessName, left, 40, { width, align: 'center' });
    if (bill.businessAddress) doc.font('Helvetica').fontSize(9).text(bill.businessAddress, { width, align: 'center' });
    doc.moveDown(0.4).font('Helvetica-Bold').fontSize(12).text('SALE BILL', { width, align: 'center' });

    let y = doc.y + 12;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Bill No: ${bill.invoiceNumber}`, left, y);
    doc.text(`Date: ${bill.date}`, left, y, { width, align: 'right' });
    y += 15;
    doc.text(`Customer: ${bill.customerName}${bill.customerPhone ? `  (${bill.customerPhone})` : ''}`, left, y, { width: 330 });
    doc.text(`Payment: ${bill.paymentMethod} · ${bill.paymentStatus}`, left, y, { width, align: 'right' });
    y = doc.y + 14;

    const heading = () => {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(1).stroke('#000000');
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('S.No', col.no, y + 4, { width: 26 });
      doc.text('Item', col.item, y + 4, { width: col.qty - col.item - 8 });
      doc.text('Qty', col.qty, y + 4, { width: 55, align: 'right' });
      doc.text('Rate', col.rate, y + 4, { width: 70, align: 'right' });
      doc.text('Amount', col.amount, y + 4, { width: right - col.amount, align: 'right' });
      y += 18;
      doc.moveTo(left, y).lineTo(right, y).stroke('#000000');
      y += 4;
      doc.font('Helvetica').fontSize(9);
    };
    heading();
    bill.lines.forEach((l, i) => {
      const label = l.sku ? `${l.name}  (${l.sku})` : l.name;
      const h = Math.max(doc.heightOfString(label, { width: col.qty - col.item - 8 }), 11) + 6;
      if (y + h > 760) { doc.addPage(); y = 40; heading(); }
      doc.text(String(i + 1), col.no, y, { width: 26 });
      doc.text(label, col.item, y, { width: col.qty - col.item - 8 });
      doc.text(String(l.quantity), col.qty, y, { width: 55, align: 'right' });
      doc.text(money(l.unitPrice), col.rate, y, { width: 70, align: 'right' });
      doc.text(money(l.total), col.amount, y, { width: right - col.amount, align: 'right' });
      y += h;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).dash(1, { space: 2 }).stroke('#9CA3AF').undash();
    });

    if (y > 650) { doc.addPage(); y = 40; }
    y += 8;
    const total = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
      doc.text(label, 360, y, { width: 100 });
      doc.text(value, 460, y, { width: right - 460, align: 'right' });
      y += bold ? 18 : 15;
    };
    total('Sub-total', money(bill.subtotal));
    if (bill.discount > 0) total('Discount', `- ${money(bill.discount)}`);
    if (bill.tax > 0) total('Tax', money(bill.tax));
    doc.moveTo(360, y - 2).lineTo(right, y - 2).lineWidth(1).stroke('#000000');
    y += 2;
    total('Total', money(bill.total), true);

    doc.font('Helvetica').fontSize(9);
    doc.text(`Amount in words: ${bill.amountInWords}`, left, y + 4, { width });
    if (bill.notes) doc.text(`Notes: ${bill.notes}`, { width });
    if (bill.edited) doc.text(bill.edited, { width });
    doc.moveDown(3).fontSize(8).fillColor('#6B7280').text(`Printed by ${bill.printedBy} on ${formatDate(new Date())}`, left, doc.y, { width, align: 'center' });
    doc.end();
  });
}
