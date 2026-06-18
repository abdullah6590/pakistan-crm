// src/lib/excel-generator.ts - Excel report generation
import ExcelJS from 'exceljs';
import { formatCurrency, formatDate } from './utils';

// ─── Generate Inventory Report ──────────────────────────────────────
export async function generateInventoryReport(items: Array<{
  sku: string; name: string; category: string; quantity: number;
  unitCost: number; unitPrice: number; totalValue: number;
  minQuantity: number; location: string;
}>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory Report');

  sheet.columns = [
    { header: 'SKU', key: 'sku', width: 12 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Min Qty', key: 'minQuantity', width: 10 },
    { header: 'Unit Cost (PKR)', key: 'unitCost', width: 15 },
    { header: 'Unit Price (PKR)', key: 'unitPrice', width: 15 },
    { header: 'Total Value (PKR)', key: 'totalValue', width: 15 },
    { header: 'Location', key: 'location', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;

  // Add data
  for (const item of items) {
    const row = sheet.addRow({
      sku: item.sku,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      unitCost: item.unitCost,
      unitPrice: item.unitPrice,
      totalValue: item.totalValue,
      location: item.location || '-',
      status: item.quantity <= item.minQuantity ? 'LOW STOCK' : 'OK',
    });

    if (item.quantity <= item.minQuantity) {
      row.getCell('status').font = { color: { argb: 'FFEF4444' }, bold: true };
    }

    row.getCell('totalValue').numFmt = '#,##0';
    row.getCell('unitCost').numFmt = '#,##0';
    row.getCell('unitPrice').numFmt = '#,##0';
  }

  // Summary row
  const totalRow = sheet.addRow({});
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const totalValue = items.reduce((s, i) => s + i.totalValue, 0);
  totalRow.getCell('sku').value = `TOTAL: ${items.length} items`;
  totalRow.getCell('quantity').value = totalQty;
  totalRow.getCell('totalValue').value = totalValue;
  totalRow.font = { bold: true };
  totalRow.getCell('totalValue').numFmt = '#,##0';

  // Freeze header
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─── Generate Sales Report ──────────────────────────────────────────
export async function generateSalesReport(sales: Array<{
  invoiceNumber: string; customer: string; date: string;
  items: number; total: number; profit: number; status: string;
}>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sales Report');

  sheet.columns = [
    { header: 'Invoice #', key: 'invoiceNumber', width: 14 },
    { header: 'Customer', key: 'customer', width: 25 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Items', key: 'items', width: 8 },
    { header: 'Total (PKR)', key: 'total', width: 16 },
    { header: 'Profit (PKR)', key: 'profit', width: 16 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;

  for (const sale of sales) {
    const row = sheet.addRow(sale);
    row.getCell('total').numFmt = '#,##0';
    row.getCell('profit').numFmt = '#,##0';

    if (sale.profit < 0) {
      row.getCell('profit').font = { color: { argb: 'FFEF4444' } };
    }
  }

  // Totals
  const totalRow = sheet.addRow({});
  totalRow.getCell('invoiceNumber').value = 'TOTAL';
  totalRow.getCell('total').value = sales.reduce((s, r) => s + r.total, 0);
  totalRow.getCell('profit').value = sales.reduce((s, r) => s + r.profit, 0);
  totalRow.font = { bold: true };
  totalRow.getCell('total').numFmt = '#,##0';
  totalRow.getCell('profit').numFmt = '#,##0';

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ─── Generate Finance Report ────────────────────────────────────────
export async function generateFinanceReport(transactions: Array<{
  ref: string; type: string; category: string;
  description: string; amount: number; date: string;
}>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Finance Report');

  sheet.columns = [
    { header: 'Ref #', key: 'ref', width: 12 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Description', key: 'description', width: 35 },
    { header: 'Amount (PKR)', key: 'amount', width: 16 },
    { header: 'Date', key: 'date', width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5CF6' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;

  let incomeTotal = 0;
  let expenseTotal = 0;

  for (const txn of transactions) {
    const row = sheet.addRow(txn);
    row.getCell('amount').numFmt = '#,##0';

    if (txn.type === 'INCOME') {
      row.getCell('amount').font = { color: { argb: 'FF10B981' } };
      incomeTotal += txn.amount;
    } else {
      row.getCell('amount').font = { color: { argb: 'FFEF4444' } };
      expenseTotal += txn.amount;
    }
  }

  // Summary
  sheet.addRow({});
  const incomeRow = sheet.addRow({ ref: '', type: 'INCOME', category: '', description: 'TOTAL INCOME', amount: incomeTotal });
  incomeRow.font = { bold: true, color: { argb: 'FF10B981' } };
  incomeRow.getCell('amount').numFmt = '#,##0';

  const expenseRow = sheet.addRow({ ref: '', type: 'EXPENSE', category: '', description: 'TOTAL EXPENSE', amount: expenseTotal });
  expenseRow.font = { bold: true, color: { argb: 'FFEF4444' } };
  expenseRow.getCell('amount').numFmt = '#,##0';

  const netRow = sheet.addRow({ ref: '', type: '', category: '', description: 'NET PROFIT/LOSS', amount: incomeTotal - expenseTotal });
  netRow.font = { bold: true, size: 12 };
  netRow.getCell('amount').numFmt = '#,##0';
  netRow.getCell('amount').font = { color: { argb: incomeTotal >= expenseTotal ? 'FF10B981' : 'FFEF4444' }, bold: true };

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}