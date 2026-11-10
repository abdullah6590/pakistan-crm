// src/components/layout/classic-icons.ts - The icons the Classic menu bar draws, by the names used in classic-menu.ts.
import { createElement } from "react";
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, BookOpen, Boxes, Calculator, CalendarDays, ChartColumn,
  ClipboardCheck, Contact, FilePlus2, FileText, HandCoins, HardDrive, Landmark, Library, List, Package, PackageOpen,
  PackagePlus, Receipt, Repeat, Scale, Sigma, TrendingUp, Truck, UserPlus, Users, Wallet, Warehouse, Weight,
  type LucideIcon,
} from "lucide-react";

export const CLASSIC_ICONS: Record<string, LucideIcon> = {
  ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, BookOpen, Boxes, Calculator, CalendarDays, ChartColumn,
  ClipboardCheck, Contact, FilePlus2, FileText, HandCoins, HardDrive, Landmark, Library, List, Package, PackageOpen,
  PackagePlus, Receipt, Repeat, Scale, Sigma, TrendingUp, Truck, UserPlus, Users, Wallet, Warehouse, Weight,
};

/** Draws the icon of that name (a box when the name is unknown). */
export function ClassicIcon({ name, className }: { name: string; className?: string }) {
  return createElement(CLASSIC_ICONS[name] ?? Package, { className, "aria-hidden": true });
}
