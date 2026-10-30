import type { NextConfig } from "next";
import { commonSecurityHeaders } from "./src/lib/security-headers";

// The Windows desktop app (desktop/build-bundle.mjs) ships a standalone server, built into its own folder so it
// never disturbs the normal build in .next. File reads whose path is only known at run time carry a
// `turbopackIgnore` comment, otherwise tracing copies the whole project (databases included) into the output
// (D-026); the bundle script refuses to finish if anything private is still found.
const desktop = process.env.CRM_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  // pdfkit reads its font files from its own folder at run time; bundled, it looks in the wrong place and every
  // PDF (bills and reports) fails. Loaded from node_modules instead, its fonts are found (and traced for desktop).
  serverExternalPackages: ["pdfkit"],
  ...(desktop ? { output: "standalone" as const, distDir: ".next-desktop" } : {}),
  async headers() {
    const headers = commonSecurityHeaders();
    if (process.env.NODE_ENV === "production" && process.env.CRM_DEPLOYMENT_PROFILE === "hosted-multi") {
      headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
    }
    return [{ source: "/(.*)", headers }];
  },
};

export default nextConfig;
