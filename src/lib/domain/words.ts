// src/lib/domain/words.ts - Amount in words (Report 09 BR-18).
// Reproduces the legacy wording: international system (Thousand/Million/Billion), "and" inside each
// hundreds group and before a final remainder under 100, hyphenated tens. Legacy text also carried
// trailing/double spaces and wrote zero as "zero"; new documents use clean spacing and "Zero".

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return underHundred(rest);
  return rest ? `${ONES[hundreds]} Hundred and ${underHundred(rest)}` : `${ONES[hundreds]} Hundred`;
}

/** Whole-rupee amount in words, e.g. 2232005 -> "Two Million Two Hundred and Thirty-Two Thousand and Five". */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount)) throw new Error("Amount must be finite");
  const whole = Math.round(Math.abs(amount));
  if (whole === 0) return "Zero";
  const groups: number[] = [];
  for (let n = whole; n > 0; n = Math.floor(n / 1000)) groups.push(n % 1000);
  if (groups.length > SCALES.length) throw new Error("Amount too large");

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const words = underThousand(g);
    if (i === 0 && g < 100 && groups.length > 1) parts.push(`and ${words}`);
    else parts.push(i ? `${words} ${SCALES[i]}` : words);
  }
  return (amount < 0 ? "Minus " : "") + parts.join(" ");
}
