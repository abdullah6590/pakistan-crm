import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, commonSecurityHeaders } from "./security-headers";

describe("web security policy", () => {
  it("uses the request nonce and blocks framing and plugins", () => {
    const policy = buildContentSecurityPolicy("known-nonce", false);
    expect(policy).toContain("script-src 'self' 'nonce-known-nonce' 'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows only the development eval relaxation and required OCR assets", () => {
    const policy = buildContentSecurityPolicy("dev-nonce", true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("worker-src 'self' blob: https://cdn.jsdelivr.net");
    expect(policy).toContain("https://tessdata.projectnaptha.com");
  });

  it("sets anti-sniffing, referrer, framing, and browser capability headers", () => {
    expect(commonSecurityHeaders()).toEqual(expect.arrayContaining([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
    ]));
  });
});
