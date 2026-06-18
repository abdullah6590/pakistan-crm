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
    doc.fontSize(14).font('Helvetica-Bold').text('Electronics Startup ERP');
    doc.fontSize(9).font('Helvetica')
      .text('IoT & Electronics Solutions')
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
    doc.font('Helvetica').text(`  ${formatCurrency(summary.totalIncome)}`, { color: '#10B981' });
    
    doc.font('Helvetica-Bold').text('Total Expenses:', 50, doc.y, { continued: true });
    doc.font('Helvetica').text(`  ${formatCurrency(summary.totalExpenses)}`, { color: '#EF4444' });
    
    doc.font('Helvetica-Bold').text('Net Profit:', 50, doc.y, { continued: true });
    const profitColor = summary.netProfit >= 0 ? '#10B981' : '#EF4444';
    doc.font('Helvetica').text(`  ${formatCurrency(summary.netProfit)}`, { color: profitColor });
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