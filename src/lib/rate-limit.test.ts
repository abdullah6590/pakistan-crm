import { describe, expect, it } from "vitest";
import { isLimited, recordFailure, clearFailures, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "./rate-limit";

describe("login rate limit (audit SEC-08)", () => {
  it("limits after the maximum failures and resets after the window or on success", () => {
    const keys = ["login:email:test@example.com"];
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordFailure(keys, t0);
    expect(isLimited(keys, t0)).toBe(false);
    recordFailure(keys, t0);
    expect(isLimited(keys, t0)).toBe(true);
    expect(isLimited(keys, t0 + LOGIN_WINDOW_MS + 1)).toBe(false);
    recordFailure(keys, t0);
    clearFailures(keys);
    expect(isLimited(keys, t0)).toBe(false);
  });
});
