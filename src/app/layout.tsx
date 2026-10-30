// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: {
    default: "PM-ERP | Paper Mill ERP",
    template: "%s | PM-ERP",
  },
  description: "Complete Business Management System for Paper Mills & Packaging",
  keywords: ["ERP", "paper", "packaging", "inventory", "Pakistan", "business management", "paper mill"],
  authors: [{ name: "Paper Mill ERP" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // next-themes injects a small inline bootstrap before hydration. Pass the same per-request nonce that Next reads
  // from Proxy, otherwise the browser correctly blocks that one script even though framework scripts are nonced.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider nonce={nonce} attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
