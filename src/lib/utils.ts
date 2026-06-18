// src/lib/utils.ts - Utility functions
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, differenceInDays, startOfMonth, endOfMonth } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Number Formatting (PKR) ───────────────────────────────────────
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ur-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('ur-PK').format(num);
}

// ─── Date Formatting ────────────────────────────────────────────────
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM dd, yyyy');
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM dd, yyyy hh:mm a');
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function daysUntil(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return differenceInDays(d, new Date());
}

// ─── ID Generators ──────────────────────────────────────────────────
export function generateProjectId(index: number): string {
  return `PRJ-${String(index).padStart(3, '0')}`;
}

export function generateInvoiceNumber(type: 'INV' | 'PO', index: number): string {
  return `${type}-${String(index).padStart(4, '0')}`;
}

export function generateTransactionRef(index: number): string {
  return `TXN-${String(index).padStart(5, '0')}`;
}

// ─── SKU Generator ──────────────────────────────────────────────────
export function generateSKU(category: string, index: number): string {
  const prefix = category.substring(0, 3).toUpperCase();
  return `${prefix}-${String(index).padStart(5, '0')}`;
}

// ─── Status Helpers ─────────────────────────────────────────────────
export const statusColors: Record<string, string> = {
  PLANNING: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  ON_HOLD: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  PAID: 'bg-emerald-100 text-emerald-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-blue-100 text-blue-800',
  OVERDUE: 'bg-red-100 text-red-800',
};

export function getStatusColor(status: string): string {
  return statusColors[status] || 'bg-slate-100 text-slate-800';
}

// ─── Profit Calculator ──────────────────────────────────────────────
export function calculateProfit(revenue: number, cost: number): number {
  return revenue - cost;
}

export function calculateProfitMargin(cost: number, sellingPrice: number): number {
  if (cost === 0) return 0;
  return ((sellingPrice - cost) / sellingPrice) * 100;
}

// ─── Array Helpers ──────────────────────────────────────────────────
export function paginate<T>(items: T[], page: number, limit: number): {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const end = start + limit;
  return {
    items: items.slice(start, end),
    total,
    page,
    limit,
    totalPages,
  };
}

// ─── Chart Color Palette ────────────────────────────────────────────
export const CHART_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
  '#84CC16', '#E11D48', '#0EA5E9', '#D946EF', '#F43F5E',
];

// ─── Month Names for Charts ─────────────────────────────────────────
export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── Dashboard Helper ───────────────────────────────────────────────
export function getMonthRange(year: number, month: number) {
  const date = new Date(year, month - 1);
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
  };
}

// ─── Validation Helpers ─────────────────────────────────────────────
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  return /^(\+92|0)?3\d{9}$/.test(phone.replace(/\D/g, ''));
}