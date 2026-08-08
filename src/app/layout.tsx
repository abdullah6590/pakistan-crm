// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

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
