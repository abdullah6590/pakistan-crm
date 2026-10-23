// src/lib/rate-limit.ts - In-memory failed-attempt limiter (audit SEC-08)
// Suitable for a single server process. A multi-instance deployment needs a shared store.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function current(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (bucket && now - bucket.windowStart > LOGIN_WINDOW_MS) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

export function isLimited(keys: string[], now = Date.now()): boolean {
  return keys.some((key) => (current(key, now)?.count ?? 0) >= LOGIN_MAX_FAILURES);
}

export function recordFailure(keys: string[], now = Date.now()): void {
  for (const key of keys) {
    const bucket = current(key, now);
    if (bucket) bucket.count += 1;
    else buckets.set(key, { count: 1, windowStart: now });
  }
}

export function clearFailures(keys: string[]): void {
  for (const key of keys) buckets.delete(key);
}
