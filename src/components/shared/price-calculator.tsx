"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Calculator, Zap, Edit3, Lock, Unlock, Weight, Ruler, Layers, Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

// ─── Types ──────────────────────────────────────────────────────────
export interface PriceCalcValues {
  dimensionX: number;
  dimensionY: number;
  gsm: number;
  divisor: number;
  weightKg: number;
  rimInSheet: number;
  ratePerKg: number;
  purchasePrice: number;
  salePrice: number;
}

interface PriceCalculatorProps {
  values: PriceCalcValues;
  onChange: (values: PriceCalcValues) => void;
  /** Compact mode hides some labels for use inside dialogs */
  compact?: boolean;
  /** If true, shows Sale Price field */
  showSalePrice?: boolean;
  /** Additional CSS class */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────
export default function PriceCalculator({
  values,
  onChange,
  compact = false,
  showSalePrice = true,
  className = "",
}: PriceCalculatorProps) {
  const [autoCalcPrice, setAutoCalcPrice] = useState(true);

  // Calculate Kg from dimensions
  const calculatedKg = useMemo(() => {
    const { dimensionX, dimensionY, gsm, divisor } = values;
    if (dimensionX > 0 && dimensionY > 0 && gsm > 0 && divisor > 0) {
      return (dimensionX * dimensionY * gsm) / divisor;
    }
    return 0;
  }, [values.dimensionX, values.dimensionY, values.gsm, values.divisor]);

  // Auto-update Kg and P-Price when dimensions change
  useEffect(() => {
    const updates: Partial<PriceCalcValues> = {};
    let needsUpdate = false;

    if (calculatedKg !== values.weightKg) {
      updates.weightKg = calculatedKg;
      needsUpdate = true;
    }

    if (autoCalcPrice && values.ratePerKg > 0 && calculatedKg > 0) {
      const newPrice = Number((calculatedKg * values.ratePerKg).toFixed(2));
      if (Math.abs(newPrice - values.purchasePrice) > 0.001) {
        updates.purchasePrice = newPrice;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      onChange({ ...values, ...updates });
    }
  }, [calculatedKg, values.ratePerKg, autoCalcPrice]);

  const updateField = useCallback(
    (field: keyof PriceCalcValues, val: string) => {
      const num = parseFloat(val) || 0;
      const updated = { ...values, [field]: num };

      // Recalculate Kg
      if (["dimensionX", "dimensionY", "gsm", "divisor"].includes(field)) {
        const x = field === "dimensionX" ? num : values.dimensionX;
        const y = field === "dimensionY" ? num : values.dimensionY;
        const g = field === "gsm" ? num : values.gsm;
        const d = field === "divisor" ? num : values.divisor;
        updated.weightKg = d > 0 ? (x * y * g) / d : 0;
      }

      // Recalculate P-Price from rate
      if (autoCalcPrice && (field === "ratePerKg" || ["dimensionX", "dimensionY", "gsm", "divisor"].includes(field))) {
        const rate = field === "ratePerKg" ? num : values.ratePerKg;
        if (rate > 0 && updated.weightKg > 0) {
          updated.purchasePrice = Number((updated.weightKg * rate).toFixed(2));
        }
      }

      onChange(updated);
    },
    [values, onChange, autoCalcPrice]
  );

  const formulaText = useMemo(() => {
    if (values.dimensionX > 0 && values.dimensionY > 0 && values.gsm > 0 && values.divisor > 0) {
      return `(${values.dimensionX} × ${values.dimensionY} × ${values.gsm}) ÷ ${values.divisor}`;
    }
    return "(X × Y × Gm) ÷ D";
  }, [values.dimensionX, values.dimensionY, values.gsm, values.divisor]);

  return (
    <div className={`rounded-xl border border-indigo-200/50 dark:border-indigo-800/30 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 dark:from-indigo-950/30 dark:via-background dark:to-violet-950/20 p-4 space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
            <Calculator className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">
              Price Calculator
            </h4>
            {!compact && (
              <p className="text-[10px] text-muted-foreground">
                Paper product weight & pricing formula
              </p>
            )}
          </div>
        </div>
        <Badge 
          variant="outline" 
          className="text-[10px] gap-1 bg-white/60 dark:bg-black/20 border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all"
          onClick={() => setAutoCalcPrice(!autoCalcPrice)}
        >
          {autoCalcPrice ? (
            <>
              <Zap className="h-3 w-3" /> Auto
            </>
          ) : (
            <>
              <Edit3 className="h-3 w-3" /> Manual
            </>
          )}
        </Badge>
      </div>

      {/* Size Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          <Ruler className="h-3 w-3" />
          <span>Size</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground font-medium">X (Length)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20"
              value={values.dimensionX || ""}
              onChange={(e) => updateField("dimensionX", e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground font-medium">Y (Width)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20"
              value={values.dimensionY || ""}
              onChange={(e) => updateField("dimensionY", e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground font-medium">Gm (GSM)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20"
              value={values.gsm || ""}
              onChange={(e) => updateField("gsm", e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground font-medium">D (Divisor)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20"
              value={values.divisor || ""}
              onChange={(e) => updateField("divisor", e.target.value)}
              placeholder="15500"
            />
          </div>
        </div>

        {/* Kg Result — animated highlight */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 h-px bg-gradient-to-r from-indigo-200 via-violet-300 to-indigo-200 dark:from-indigo-800 dark:via-violet-700 dark:to-indigo-800" />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25 text-xs font-bold tabular-nums transition-all duration-300">
            <Weight className="h-3 w-3" />
            <span>Kg =</span>
            <span className="text-sm">{calculatedKg > 0 ? calculatedKg.toFixed(4) : "—"}</span>
          </div>
          <div className="flex-1 h-px bg-gradient-to-r from-indigo-200 via-violet-300 to-indigo-200 dark:from-indigo-800 dark:via-violet-700 dark:to-indigo-800" />
        </div>

        {/* Formula display */}
        {calculatedKg > 0 && (
          <p className="text-center text-[10px] text-muted-foreground font-mono tracking-wide animate-in fade-in duration-300">
            {formulaText} = <span className="font-semibold text-indigo-600 dark:text-indigo-400">{calculatedKg.toFixed(6)}</span>
          </p>
        )}
      </div>

      {/* Qty & Catan Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          <Layers className="h-3 w-3" />
          <span>Qty & Catan</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground font-medium">Rim in Sheet</Label>
            <Input
              type="number"
              step="1"
              min="1"
              className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20"
              value={values.rimInSheet || ""}
              onChange={(e) => updateField("rimInSheet", e.target.value)}
              placeholder="100"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground font-medium">Rate / Kg (Rs.)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20"
              value={values.ratePerKg || ""}
              onChange={(e) => updateField("ratePerKg", e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Product Pricing Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          <Scale className="h-3 w-3" />
          <span>Product Pricing</span>
        </div>
        <div className={`grid ${showSalePrice ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground font-medium">
                P-Price (Rs.)
              </Label>
              {autoCalcPrice && values.ratePerKg > 0 && (
                <Lock className="h-2.5 w-2.5 text-indigo-400" />
              )}
              {!autoCalcPrice && (
                <Unlock className="h-2.5 w-2.5 text-amber-400" />
              )}
            </div>
            <Input
              type="number"
              step="any"
              min="0"
              className={`h-8 text-xs font-semibold tabular-nums transition-colors ${
                autoCalcPrice && values.ratePerKg > 0
                  ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                  : "bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40"
              } focus:border-indigo-400 focus:ring-indigo-400/20`}
              value={values.purchasePrice === 0 ? "" : values.purchasePrice}
              onChange={(e) => {
                if (!autoCalcPrice || values.ratePerKg <= 0) {
                  onChange({ ...values, purchasePrice: parseFloat(e.target.value) || 0 });
                }
              }}
              readOnly={autoCalcPrice && values.ratePerKg > 0}
              placeholder="0.00"
            />
            {autoCalcPrice && values.ratePerKg > 0 && calculatedKg > 0 && (
              <p className="text-[9px] text-indigo-500 font-mono">
                = {calculatedKg.toFixed(4)} × {values.ratePerKg} = Rs.{(calculatedKg * values.ratePerKg).toFixed(2)}
              </p>
            )}
          </div>
          {showSalePrice && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground font-medium">
                Sale Price (Rs.)
              </Label>
              <Input
                type="number"
                step="any"
                min="0"
                className="h-8 text-xs bg-white/80 dark:bg-black/20 border-indigo-100 dark:border-indigo-800/40 focus:border-indigo-400 focus:ring-indigo-400/20 font-semibold tabular-nums"
                value={values.salePrice || ""}
                onChange={(e) => onChange({ ...values, salePrice: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
              />
              {values.salePrice > 0 && values.purchasePrice > 0 && (
                <p className={`text-[9px] font-mono ${values.salePrice >= values.purchasePrice ? "text-emerald-500" : "text-red-500"}`}>
                  Margin: Rs.{(values.salePrice - values.purchasePrice).toFixed(2)} ({((values.salePrice - values.purchasePrice) / values.purchasePrice * 100).toFixed(1)}%)
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper: Default values ─────────────────────────────────────────
export const defaultCalcValues: PriceCalcValues = {
  dimensionX: 0,
  dimensionY: 0,
  gsm: 0,
  divisor: 15500,
  weightKg: 0,
  rimInSheet: 100,
  ratePerKg: 0,
  purchasePrice: 0,
  salePrice: 0,
};
