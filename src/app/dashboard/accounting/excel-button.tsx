// src/app/dashboard/accounting/excel-button.tsx - "Download Excel" next to Print on Books reports and ledgers.
import { FileSpreadsheet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ExcelButton({ query }: { query: Record<string, string | undefined> }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  return (
    <a href={`/api/accounting/reports/export?${params.toString()}`} className={`${buttonVariants({ size: "sm", variant: "outline" })} print:hidden`}>
      <FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden />Download Excel
    </a>
  );
}
