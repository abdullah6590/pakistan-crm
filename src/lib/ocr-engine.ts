// src/lib/ocr-engine.ts — Invoice OCR & Parser
// Uses Tesseract.js for offline text recognition + custom parser for Pakistani invoices

import Tesseract from "tesseract.js";

// ─── Types ───────────────────────────────────────────────────────────
export interface ParsedLineItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  confidence: "high" | "medium" | "low";
  rawText: string;
}

export interface ParsedInvoice {
  supplierName: string | null;
  invoiceNumber: string | null;
  date: string | null;
  items: ParsedLineItem[];
  subtotal: number | null;
  tax: number | null;
  grandTotal: number | null;
  rawText: string;
  confidence: number; // 0-100
}

// ─── OCR Engine ──────────────────────────────────────────────────────

let workerInstance: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (workerInstance) return workerInstance;
  
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: () => {}, // silent
  });

  workerInstance = worker;
  return worker;
}

export async function recognizeText(
  image: File | string,
  onProgress?: (progress: number) => void
): Promise<{ text: string; confidence: number }> {
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m: any) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  const result = await worker.recognize(image);
  const text = result.data.text;
  const confidence = result.data.confidence;

  await worker.terminate();

  return { text, confidence };
}

// ─── Invoice Parser ──────────────────────────────────────────────────
// Parses the raw OCR text into structured invoice data.
// Handles common Pakistani invoice formats:
//   - "Item Name    Qty    Rate    Amount"
//   - "1. Pizza Box  x 500  @ 120  = 60,000"
//   - Various date and total formats

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  const invoice: ParsedInvoice = {
    supplierName: null,
    invoiceNumber: null,
    date: null,
    items: [],
    subtotal: null,
    tax: null,
    grandTotal: null,
    rawText,
    confidence: 0,
  };

  // ─── Extract Supplier Name (usually first non-empty line) ──────
  if (lines.length > 0) {
    const firstLine = lines[0];
    // If the first line doesn't look like a number or date, it's probably the supplier name
    if (!/^\d+[\/\-]/.test(firstLine) && !/^(invoice|bill|receipt|date|qty)/i.test(firstLine)) {
      invoice.supplierName = firstLine.replace(/[^a-zA-Z0-9\s&.,'-]/g, "").trim();
    }
  }

  // ─── Extract Invoice Number ────────────────────────────────────
  const invPatterns = [
    /(?:invoice|inv|bill|receipt|voucher)\s*(?:no|#|number)?[.:\s]*([A-Z0-9\-\/]+)/i,
    /(?:ref|reference)[.:\s]*([A-Z0-9\-\/]+)/i,
    /#\s*([A-Z0-9\-\/]+)/i,
  ];
  for (const line of lines) {
    for (const pattern of invPatterns) {
      const match = line.match(pattern);
      if (match) {
        invoice.invoiceNumber = match[1].trim();
        break;
      }
    }
    if (invoice.invoiceNumber) break;
  }

  // ─── Extract Date ──────────────────────────────────────────────
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,         // DD/MM/YYYY or MM/DD/YYYY
    /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{2,4})/i, // 27 Jul 2026
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,             // YYYY-MM-DD
  ];
  for (const line of lines) {
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        invoice.date = match[0];
        break;
      }
    }
    if (invoice.date) break;
  }

  // ─── Extract Line Items ────────────────────────────────────────
  // Strategy: Look for lines that contain at least 2 numbers (qty & price)
  // Common formats:
  //   "Pizza Box 500 120 60000"
  //   "1 Pizza Box 500 120.00 60,000"
  //   "Pizza Box  x500  @120  =60000"
  //   "Pizza Box | 500 | 120 | 60,000"

  const numberPattern = /[\d,]+\.?\d*/g;
  const skipKeywords = /^(total|subtotal|sub-total|grand|tax|gst|vat|shipping|freight|discount|balance|amount|date|invoice|bill|receipt|qty|quantity|rate|price|s\.?no|sr|description|item|particular|net)/i;

  for (const line of lines) {
    // Skip header/footer lines
    if (skipKeywords.test(line.trim())) continue;
    if (line.length < 5) continue;

    // Find all numbers in the line
    const numbers = line.match(numberPattern);
    if (!numbers || numbers.length < 2) continue;

    // Parse the numbers (remove commas)
    const parsedNums = numbers.map(n => parseFloat(n.replace(/,/g, "")));
    
    // Filter out unreasonable values (like years, serial numbers at start)
    const validNums = parsedNums.filter(n => !isNaN(n) && n >= 0);
    if (validNums.length < 2) continue;

    // Extract the text part (everything before the first number cluster)
    const firstNumIndex = line.search(/\d/);
    let itemName = line.substring(0, firstNumIndex).trim();
    
    // Clean up item name - remove leading numbers (like serial "1." or "01")
    itemName = itemName.replace(/^\d+[\.\)\-\s]+/, "").trim();
    // Remove separators
    itemName = itemName.replace(/[|:]+$/, "").trim();
    
    if (itemName.length < 2) {
      // Try to extract name differently - maybe the name is between numbers
      const parts = line.split(/\s{2,}|\t|\|/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 3) {
        // Find the part that looks most like a name (has letters)
        const namePart = parts.find(p => /[a-zA-Z]/.test(p) && !/^\d/.test(p));
        if (namePart) itemName = namePart;
      }
    }
    
    if (itemName.length < 2) continue;

    // Determine qty, rate, total from the numbers
    let qty = 1, unitPrice = 0, total = 0;
    
    if (validNums.length >= 3) {
      // Most likely: qty, rate, total (or variations)
      // Try to find the pair where qty * rate ≈ total
      const [a, b, c] = validNums.slice(-3);
      if (Math.abs(a * b - c) < c * 0.05) {
        qty = a; unitPrice = b; total = c;
      } else if (Math.abs(a * c - b) < b * 0.05) {
        qty = a; unitPrice = c; total = b;
      } else if (Math.abs(b * c - a) < a * 0.05) {
        qty = b; unitPrice = c; total = a;
      } else {
        // Can't determine relationship, assume last 3 are qty, rate, total
        qty = a; unitPrice = b; total = c;
      }
    } else if (validNums.length === 2) {
      // Could be qty+rate or qty+total or rate+total
      const [a, b] = validNums;
      if (b > a && b > 100) {
        // Likely qty and total
        qty = a; total = b; unitPrice = qty > 0 ? total / qty : 0;
      } else {
        // Likely qty and rate
        qty = a; unitPrice = b; total = qty * unitPrice;
      }
    }

    // Determine confidence
    let confidence: "high" | "medium" | "low" = "low";
    if (qty > 0 && unitPrice > 0 && Math.abs(qty * unitPrice - total) < total * 0.02) {
      confidence = "high";
    } else if (qty > 0 && (unitPrice > 0 || total > 0)) {
      confidence = "medium";
    }

    invoice.items.push({
      id: crypto.randomUUID(),
      name: itemName,
      quantity: Math.round(qty),
      unitPrice: Math.round(unitPrice * 100) / 100,
      total: Math.round(total * 100) / 100,
      confidence,
      rawText: line,
    });
  }

  // ─── Extract Totals ────────────────────────────────────────────
  for (const line of lines) {
    const totalMatch = line.match(/(?:grand\s*total|total\s*amount|net\s*total|total)[:\s]*([\d,]+\.?\d*)/i);
    if (totalMatch) {
      invoice.grandTotal = parseFloat(totalMatch[1].replace(/,/g, ""));
    }
    const subMatch = line.match(/(?:sub\s*-?\s*total)[:\s]*([\d,]+\.?\d*)/i);
    if (subMatch) {
      invoice.subtotal = parseFloat(subMatch[1].replace(/,/g, ""));
    }
    const taxMatch = line.match(/(?:tax|gst|vat)[:\s]*([\d,]+\.?\d*)/i);
    if (taxMatch) {
      invoice.tax = parseFloat(taxMatch[1].replace(/,/g, ""));
    }
  }

  // ─── Calculate Overall Confidence ──────────────────────────────
  if (invoice.items.length > 0) {
    const highCount = invoice.items.filter(i => i.confidence === "high").length;
    const medCount = invoice.items.filter(i => i.confidence === "medium").length;
    invoice.confidence = Math.round(
      ((highCount * 100 + medCount * 60) / invoice.items.length)
    );
  }

  return invoice;
}

// ─── Cleanup ─────────────────────────────────────────────────────────
export async function terminateWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
  }
}
