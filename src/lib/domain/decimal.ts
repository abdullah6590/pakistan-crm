// src/lib/domain/decimal.ts - Exact fixed-point arithmetic for money and quantities.
// Values are bigint integers scaled by 10^12, so no binary floating-point error enters calculations
// (audit BUG-14). All rounding is explicit and half-to-even unless stated otherwise.

export type Dec = bigint;

export const SCALE_DIGITS = 12;
const SCALE = BigInt(10) ** BigInt(SCALE_DIGITS);

/** Parse a number or decimal string ("12.5", "-0.001", "1e-3") exactly. */
export function dec(value: number | string | bigint): Dec {
  if (typeof value === "bigint") return value * SCALE;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
    // Shortest round-trip representation, then parse exactly
    value = String(value);
  }
  const s = value.trim();
  const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) throw new Error(`Not a decimal: "${value}"`);
  const sign = m[1] === "-" ? -BigInt(1) : BigInt(1);
  let digits = (m[2] || "") + (m[3] || "");
  const exp = (m[4] ? parseInt(m[4], 10) : 0) - (m[3] || "").length + SCALE_DIGITS;
  if (digits === "") digits = "0";
  let n = BigInt(digits);
  if (exp >= 0) return sign * n * BigInt(10) ** BigInt(exp);
  // More precision than the scale holds: round half-to-even
  const divisor = BigInt(10) ** BigInt(-exp);
  n = divRoundHalfEven(n, divisor);
  return sign * n;
}

function divRoundHalfEven(n: bigint, d: bigint): bigint {
  const negative = (n < BigInt(0)) !== (d < BigInt(0));
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  let q = an / ad;
  const r = an % ad;
  const twice = r * BigInt(2);
  if (twice > ad || (twice === ad && q % BigInt(2) === BigInt(1))) q += BigInt(1);
  return negative ? -q : q;
}

export const ZERO: Dec = BigInt(0);

export function add(...values: Dec[]): Dec {
  return values.reduce((a, b) => a + b, ZERO);
}

export function sub(a: Dec, b: Dec): Dec {
  return a - b;
}

export function mul(a: Dec, b: Dec): Dec {
  return divRoundHalfEven(a * b, SCALE);
}

export function div(a: Dec, b: Dec): Dec {
  if (b === ZERO) throw new Error("Division by zero");
  return divRoundHalfEven(a * SCALE, b);
}

export function neg(a: Dec): Dec {
  return -a;
}

export function cmp(a: Dec, b: Dec): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isZero(a: Dec): boolean {
  return a === ZERO;
}

export function isNegative(a: Dec): boolean {
  return a < ZERO;
}

export function abs(a: Dec): Dec {
  return a < ZERO ? -a : a;
}

/** Round to `dp` decimal places, half-to-even (the .NET Math.Round default the legacy client used). */
export function roundHalfEven(a: Dec, dp: number): Dec {
  const unit = BigInt(10) ** BigInt(SCALE_DIGITS - dp);
  return divRoundHalfEven(a, unit) * unit;
}

/** True when the value has no digits beyond `dp` decimal places. */
export function hasAtMostDecimals(a: Dec, dp: number): boolean {
  const unit = BigInt(10) ** BigInt(SCALE_DIGITS - dp);
  return a % unit === ZERO;
}

export function isInteger(a: Dec): boolean {
  return a % SCALE === ZERO;
}

export function toNumber(a: Dec): number {
  return Number(a) / Number(SCALE);
}

/** Exact decimal string with `dp` places (value is rounded half-to-even first). */
export function toFixed(a: Dec, dp: number): string {
  const r = roundHalfEven(a, dp);
  const negative = r < ZERO;
  const s = (negative ? -r : r).toString().padStart(SCALE_DIGITS + 1, "0");
  const intPart = s.slice(0, s.length - SCALE_DIGITS);
  const frac = s.slice(s.length - SCALE_DIGITS, s.length - SCALE_DIGITS + dp);
  return (negative && r !== ZERO ? "-" : "") + intPart + (dp > 0 ? "." + frac : "");
}

export function sum(values: Dec[]): Dec {
  return add(...values);
}

/** Exact decimal text without trailing zeros ("325", "4.1305"), used to store values losslessly. */
export function toPlain(a: Dec): string {
  return toFixed(a, SCALE_DIGITS).replace(/\.?0+$/, "") || "0";
}

const PAISA_UNIT = BigInt(10) ** BigInt(SCALE_DIGITS - 2);

/** Whole paisa for journal storage; the amount must already be rounded to 2 decimals. */
export function toPaisa(a: Dec): bigint {
  if (!hasAtMostDecimals(a, 2)) throw new Error("Journal amounts must be rounded to paisa before storage");
  return a / PAISA_UNIT;
}

export function fromPaisa(p: bigint): Dec {
  return p * PAISA_UNIT;
}
