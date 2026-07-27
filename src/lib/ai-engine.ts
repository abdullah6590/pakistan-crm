// src/lib/ai-engine.ts — Smart AI Features (All Offline, Lightweight)
// Stock Predictions, Duplicate Detection, Auto Price Suggestion, Anomaly Detection

// ─── Types ───────────────────────────────────────────────────────────

export interface StockPrediction {
  componentId: string;
  componentName: string;
  currentStock: number;
  dailyUsageRate: number; // average units sold per day
  daysUntilStockout: number; // predicted days until stock reaches 0
  urgency: "critical" | "warning" | "safe";
  recommendation: string;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  phone?: string | null;
  similarity: number; // 0-100
  matchType: "exact" | "fuzzy" | "phone";
}

export interface PriceSuggestion {
  purchaseRate: number;
  expenses: number;
  costPrice: number;
  suggestedPrices: {
    margin: number;     // percentage
    price: number;
    profit: number;
    label: string;      // "Minimum", "Standard", "Premium"
  }[];
  belowCostWarning: boolean;
}

export interface AnomalyAlert {
  id: string;
  type: "high_value" | "unusual_quantity" | "new_customer_large" | "price_deviation";
  severity: "high" | "medium" | "low";
  message: string;
  details: string;
  value: number;
  average: number;
  timestamp: string;
}

// ─── 1. STOCK PREDICTIONS ────────────────────────────────────────────
// Analyzes sales history to predict when stock will run out

export function predictStockLevels(
  components: {
    id: string;
    name: string;
    quantity: number;
    minQuantity: number;
    totalSold: number;
    createdAt: string;
  }[]
): StockPrediction[] {
  const now = new Date();
  const predictions: StockPrediction[] = [];

  for (const comp of components) {
    // Calculate daily usage rate based on total sold and age of component
    const createdDate = new Date(comp.createdAt);
    const daysActive = Math.max(1, Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyUsageRate = comp.totalSold / daysActive;

    // Predict days until stockout
    const daysUntilStockout = dailyUsageRate > 0
      ? Math.floor(comp.quantity / dailyUsageRate)
      : comp.quantity > 0 ? 999 : 0;

    // Determine urgency
    let urgency: "critical" | "warning" | "safe" = "safe";
    let recommendation = "";

    if (comp.quantity <= 0) {
      urgency = "critical";
      recommendation = `OUT OF STOCK! Reorder immediately. Average daily demand: ${dailyUsageRate.toFixed(1)} units.`;
    } else if (daysUntilStockout <= 3) {
      urgency = "critical";
      recommendation = `Stock will run out in ${daysUntilStockout} day(s)! Order at least ${Math.ceil(dailyUsageRate * 14)} units for 2 weeks.`;
    } else if (daysUntilStockout <= 7) {
      urgency = "warning";
      recommendation = `Stock running low. Will last ~${daysUntilStockout} days. Consider reordering ${Math.ceil(dailyUsageRate * 14)} units.`;
    } else if (comp.quantity <= comp.minQuantity) {
      urgency = "warning";
      recommendation = `Below minimum stock level (${comp.minQuantity}). ~${daysUntilStockout} days remaining.`;
    } else {
      recommendation = `Stock is healthy. ~${daysUntilStockout} days of supply remaining.`;
    }

    // Only include items with actual activity or low stock
    if (urgency !== "safe" || dailyUsageRate > 0) {
      predictions.push({
        componentId: comp.id,
        componentName: comp.name,
        currentStock: comp.quantity,
        dailyUsageRate: Math.round(dailyUsageRate * 10) / 10,
        daysUntilStockout,
        urgency,
        recommendation,
      });
    }
  }

  // Sort: critical first, then warning, then by days until stockout
  predictions.sort((a, b) => {
    const urgencyOrder = { critical: 0, warning: 1, safe: 2 };
    if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    }
    return a.daysUntilStockout - b.daysUntilStockout;
  });

  return predictions;
}

// ─── 2. DUPLICATE DETECTION ──────────────────────────────────────────
// Fuzzy string matching using Levenshtein distance

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function similarityScore(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();

  if (aLower === bLower) return 100;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 90;

  const maxLen = Math.max(aLower.length, bLower.length);
  if (maxLen === 0) return 100;

  const distance = levenshteinDistance(aLower, bLower);
  return Math.round((1 - distance / maxLen) * 100);
}

export function findDuplicates(
  newName: string,
  newPhone: string | null | undefined,
  existingEntries: { id: string; name: string; phone?: string | null }[],
  threshold: number = 70
): DuplicateMatch[] {
  if (!newName || newName.trim().length < 2) return [];

  const matches: DuplicateMatch[] = [];

  for (const entry of existingEntries) {
    let bestScore = 0;
    let matchType: "exact" | "fuzzy" | "phone" = "fuzzy";

    // Check name similarity
    const nameSim = similarityScore(newName, entry.name);
    if (nameSim >= threshold) {
      bestScore = nameSim;
      matchType = nameSim === 100 ? "exact" : "fuzzy";
    }

    // Check phone match (exact match on phone is very strong signal)
    if (newPhone && entry.phone && newPhone.trim().length >= 7) {
      const cleanNew = newPhone.replace(/[\s\-\(\)]/g, "");
      const cleanExisting = entry.phone.replace(/[\s\-\(\)]/g, "");
      if (cleanNew === cleanExisting || cleanNew.endsWith(cleanExisting) || cleanExisting.endsWith(cleanNew)) {
        bestScore = Math.max(bestScore, 95);
        matchType = "phone";
      }
    }

    if (bestScore >= threshold) {
      matches.push({
        id: entry.id,
        name: entry.name,
        phone: entry.phone,
        similarity: bestScore,
        matchType,
      });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, 5); // top 5
}

// ─── 3. AUTO PRICE SUGGESTION ────────────────────────────────────────
// Calculates suggested sale prices based on cost + expenses + margin

export function suggestPrices(
  purchaseRate: number,
  expenses: number = 0
): PriceSuggestion {
  const costPrice = purchaseRate + expenses;

  const margins = [
    { margin: 10, label: "Minimum (10%)" },
    { margin: 15, label: "Standard (15%)" },
    { margin: 20, label: "Good (20%)" },
    { margin: 25, label: "Premium (25%)" },
    { margin: 30, label: "High (30%)" },
  ];

  return {
    purchaseRate,
    expenses,
    costPrice,
    suggestedPrices: margins.map(({ margin, label }) => ({
      margin,
      price: Math.round(costPrice * (1 + margin / 100)),
      profit: Math.round(costPrice * (margin / 100)),
      label,
    })),
    belowCostWarning: false,
  };
}

export function checkBelowCost(
  salePrice: number,
  purchaseRate: number,
  expenses: number = 0
): { isBelow: boolean; loss: number; message: string } {
  const costPrice = purchaseRate + expenses;
  const isBelow = salePrice < costPrice;
  const loss = isBelow ? costPrice - salePrice : 0;

  return {
    isBelow,
    loss,
    message: isBelow
      ? `⚠️ Selling below cost! Loss of Rs. ${loss.toLocaleString()} per unit (Cost: ${costPrice.toLocaleString()}, Sale: ${salePrice.toLocaleString()})`
      : "",
  };
}

// ─── 4. ANOMALY DETECTION ────────────────────────────────────────────
// Flags transactions that deviate significantly from normal patterns

export function detectAnomalies(
  transactions: {
    id: string;
    type: "sale" | "purchase" | "expense";
    amount: number;
    customerName?: string;
    description?: string;
    timestamp: string;
    isNewCustomer?: boolean;
  }[],
  historicalAverage?: { saleAvg: number; purchaseAvg: number; expenseAvg: number }
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];

  // Calculate averages from provided data if not given
  const sales = transactions.filter(t => t.type === "sale");
  const purchases = transactions.filter(t => t.type === "purchase");
  const expenses = transactions.filter(t => t.type === "expense");

  const saleAvg = historicalAverage?.saleAvg ||
    (sales.length > 2 ? sales.reduce((s, t) => s + t.amount, 0) / sales.length : 0);
  const purchaseAvg = historicalAverage?.purchaseAvg ||
    (purchases.length > 2 ? purchases.reduce((s, t) => s + t.amount, 0) / purchases.length : 0);
  const expenseAvg = historicalAverage?.expenseAvg ||
    (expenses.length > 2 ? expenses.reduce((s, t) => s + t.amount, 0) / expenses.length : 0);

  for (const tx of transactions) {
    const avg = tx.type === "sale" ? saleAvg : tx.type === "purchase" ? purchaseAvg : expenseAvg;
    if (avg <= 0) continue;

    const ratio = tx.amount / avg;

    // Flag if transaction is 3x above average
    if (ratio >= 3) {
      alerts.push({
        id: `anomaly-${tx.id}`,
        type: "high_value",
        severity: ratio >= 5 ? "high" : "medium",
        message: `Unusually high ${tx.type}: Rs. ${tx.amount.toLocaleString()}`,
        details: `This ${tx.type} is ${ratio.toFixed(1)}x higher than average (Rs. ${Math.round(avg).toLocaleString()}). ${tx.customerName ? `Customer: ${tx.customerName}` : ""}`.trim(),
        value: tx.amount,
        average: avg,
        timestamp: tx.timestamp,
      });
    }

    // Flag large orders from new customers
    if (tx.type === "sale" && tx.isNewCustomer && ratio >= 2) {
      alerts.push({
        id: `new-customer-${tx.id}`,
        type: "new_customer_large",
        severity: ratio >= 4 ? "high" : "medium",
        message: `Large order from new customer: ${tx.customerName || "Walk-in"}`,
        details: `Rs. ${tx.amount.toLocaleString()} from a first-time customer. Average order is Rs. ${Math.round(avg).toLocaleString()}.`,
        value: tx.amount,
        average: avg,
        timestamp: tx.timestamp,
      });
    }
  }

  // Sort by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}
