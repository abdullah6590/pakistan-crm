"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrintButton() {
  return (
    <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer className="mr-1 h-4 w-4" />Print
    </Button>
  );
}
