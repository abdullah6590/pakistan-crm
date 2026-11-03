// src/lib/periods.ts - Quick date choices for reports and ledgers. Pakistan's financial year runs 1 July to 30 June.
// Dates are plain YYYY-MM-DD strings in the business's own calendar, as the date boxes use them.

export interface Period { key: string; label: string; from: string; to: string }
export interface AsOf { key: string; label: string; to: string }

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** The year in which the financial year containing this date started (July onwards belongs to the new year). */
const fyStart = (y: number, m: number) => (m >= 6 ? y : y - 1);
const fyLabel = (start: number) => `${start}-${String(start + 1).slice(2)}`;

export function periods(today: Date = new Date()): Period[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const [py, pm] = m === 0 ? [y - 1, 11] : [y, m - 1];
  const fy = fyStart(y, m);
  return [
    { key: "today", label: "Today", from: iso(y, m, d), to: iso(y, m, d) },
    { key: "this-month", label: "This month", from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) },
    { key: "last-month", label: "Last month", from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) },
    { key: "this-fy", label: `This financial year (${fyLabel(fy)})`, from: iso(fy, 6, 1), to: iso(fy + 1, 5, 30) },
    { key: "last-fy", label: `Last financial year (${fyLabel(fy - 1)})`, from: iso(fy - 1, 6, 1), to: iso(fy, 5, 30) },
  ];
}

/** "As on" choices for balances (trial balance, Balance Sheet). */
export function asOfDates(today: Date = new Date()): AsOf[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const [py, pm] = m === 0 ? [y - 1, 11] : [y, m - 1];
  const fy = fyStart(y, m);
  return [
    { key: "today", label: "Today", to: iso(y, m, today.getDate()) },
    { key: "end-last-month", label: "End of last month", to: iso(py, pm, lastDay(py, pm)) },
    { key: "end-last-fy", label: `End of last financial year (30 June ${fy})`, to: iso(fy, 5, 30) },
  ];
}
