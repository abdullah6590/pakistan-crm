// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: {
    default: "ES-ERP | Electronics Startup ERP",
    template: "%s | ES-ERP",
  },
  description: "Complete Business Management System for Electronics & IoT Startups",
  keywords: ["ERP", "electronics", "IoT", "inventory", "Pakistan", "business management"],
  authors: [{ name: "Electronics Startup ERP" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
