"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Filter, Printer, LineChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface FilterOption {
  key: string;
  label: string;
  type: "select" | "date" | "number" | "search";
  placeholder?: string;
  options?: { label: string; value: string }[];
}

interface Props {
  filters: FilterOption[];
  onSearchChange?: (term: string) => void;
  showPrint?: boolean;
  showAnalyze?: boolean;
  moduleName?: string;
}

export function AdvancedFilter({ filters, onSearchChange, showPrint = true, showAnalyze = true, moduleName }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeFilters, setActiveFilters] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    const current: { [key: string]: string } = {};
    searchParams.forEach((value, key) => {
      if (key !== "page" && value && value !== "all") {
        current[key] = value;
      }
    });
    setActiveFilters(current);
  }, [searchParams]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("page", "1");
    
    // Custom search handler if provided (for debouncing)
    if (key === "search" && onSearchChange) {
      onSearchChange(value);
      return;
    }
    
    router.push(`?${params.toString()}`);
  };

  const removeFilter = (key: string) => {
    updateFilter(key, "");
  };

  const clearAll = () => {
    router.push("?page=1");
  };

  const handlePrint = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("page");
    if (moduleName) params.set("module", moduleName);
    window.open(`/dashboard/print?${params.toString()}`, "_blank");
  };

  const handleAnalyze = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("page");
    if (moduleName) params.set("module", moduleName);
    router.push(`/dashboard/analysis?${params.toString()}`);
  };

  const getFilterLabel = (key: string, value: string) => {
    const filter = filters.find(f => f.key === key);
    if (!filter) return `${key}: ${value}`;
    if (filter.type === "select" && filter.options) {
      const opt = filter.options.find(o => o.value === value);
      return opt ? `${filter.label}: ${opt.label}` : `${filter.label}: ${value}`;
    }
    return `${filter.label}: ${value}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center p-4 bg-card border rounded-lg shadow-sm">
        <div className="flex items-center justify-between w-full sm:w-auto sm:flex-none">
          <div className="flex items-center gap-2 text-muted-foreground mr-2 hidden sm:flex">
            <Filter className="h-4 w-4" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            {showPrint && (
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4" />
              </Button>
            )}
            {showAnalyze && (
              <Button variant="outline" size="sm" onClick={handleAnalyze}>
                <LineChart className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {filters.map((filter) => {
          if (filter.type === "search") {
            return (
              <div key={filter.key} className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={filter.placeholder || "Search..."}
                  className="pl-9 h-9"
                  defaultValue={searchParams.get(filter.key) || ""}
                  onChange={(e) => {
                    if (filter.key === "search" && onSearchChange) {
                      onSearchChange(e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (!onSearchChange)) {
                      updateFilter(filter.key, e.currentTarget.value);
                    }
                  }}
                  onBlur={(e) => {
                    if (!onSearchChange) updateFilter(filter.key, e.target.value);
                  }}
                />
              </div>
            );
          }

          if (filter.type === "select") {
            return (
              <Select 
                key={filter.key}
                value={searchParams.get(filter.key) || "all"}
                onChange={(val) => updateFilter(filter.key, val)}
              >
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder={filter.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All {filter.label}</SelectItem>
                  {filter.options?.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          }

          if (filter.type === "date") {
            return (
              <div key={filter.key} className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">{filter.label}</Label>
                <Input
                  type="date"
                  className="h-9 w-[140px]"
                  value={searchParams.get(filter.key) || ""}
                  onChange={(e) => updateFilter(filter.key, e.target.value)}
                />
              </div>
            );
          }

          if (filter.type === "number") {
            return (
              <div key={filter.key} className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder={filter.placeholder || filter.label}
                  className="h-9 w-[120px]"
                  defaultValue={searchParams.get(filter.key) || ""}
                  onBlur={(e) => updateFilter(filter.key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updateFilter(filter.key, e.currentTarget.value);
                  }}
                />
              </div>
            );
          }
          return null;
        })}

        <div className="flex items-center gap-2 ml-auto hidden sm:flex">
          {showAnalyze && (
            <Button variant="outline" size="sm" onClick={handleAnalyze} className="gap-2">
              <LineChart className="h-4 w-4" />
              <span className="hidden md:inline">Analyze</span>
            </Button>
          )}
          {showPrint && (
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              <span className="hidden md:inline">Print / Export</span>
            </Button>
          )}
        </div>
      </div>

      {Object.keys(activeFilters).length > 0 && (
        <div className="flex flex-wrap gap-2 items-center px-1">
          <span className="text-xs text-muted-foreground">Active:</span>
          {Object.entries(activeFilters).map(([key, value]) => {
            if (key === "search") return null; // usually search is handled visually in the input
            return (
              <Badge key={key} variant="secondary" className="flex items-center gap-1 font-normal bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                {getFilterLabel(key, value)}
                <X 
                  className="h-3 w-3 cursor-pointer hover:text-red-500" 
                  onClick={() => removeFilter(key)}
                />
              </Badge>
            );
          })}
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-6 text-xs px-2 text-muted-foreground">
            Clear All
          </Button>
        </div>
      )}
    </div>
  );
}
