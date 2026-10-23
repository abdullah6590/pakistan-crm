"use client";

import { TableHead } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode } from "react";

interface SortableTableHeadProps {
  field: string;
  children: ReactNode;
  className?: string;
}

export function SortableTableHead({ field, children, className }: SortableTableHeadProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSortField = searchParams.get("sort");
  const currentSortOrder = searchParams.get("order");

  const isActive = currentSortField === field;

  // Sorting Cycle: DEFAULT (none) -> DESC -> ASC -> DEFAULT
  const handleSort = () => {
    const params = new URLSearchParams(searchParams.toString());

    // Reset pagination
    params.set("page", "1");

    if (!isActive) {
      // First click: Sort Descending
      params.set("sort", field);
      params.set("order", "desc");
    } else if (isActive && currentSortOrder === "desc") {
      // Second click: Sort Ascending
      params.set("sort", field);
      params.set("order", "asc");
    } else {
      // Third click: Default (remove sorting)
      params.delete("sort");
      params.delete("order");
    }

    router.push(`?${params.toString()}`);
  };

  return (
    <TableHead 
      className={`cursor-pointer hover:bg-slate-50 transition-colors select-none ${className || ""}`} 
      onClick={handleSort}
    >
      <div className="flex items-center gap-1">
        <span>{children}</span>
        {isActive ? (
          currentSortOrder === "asc" ? (
            <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-300" />
        )}
      </div>
    </TableHead>
  );
}
