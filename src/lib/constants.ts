// src/lib/constants.ts - Application constants
import {
  LayoutDashboard, FolderKanban, Package, ShoppingCart,
  Truck, DollarSign, Users, BarChart3,
  Settings, Bell, UserCog, Store,
  Receipt, FileText, AlertTriangle, TrendingUp,
  TrendingDown, Wallet, Banknote, CreditCard,
  BookOpen, HardDrive, ArrowLeftRight, Building2,
  Warehouse, HandCoins,
  type LucideIcon,
} from 'lucide-react';

// ─── Navigation ─────────────────────────────────────────────────────
export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles: string[];
  children?: NavItem[];
}

export const SIDEBAR_NAV: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'PARTNER', 'EMPLOYEE', 'INVENTORY_MANAGER', 'ACCOUNTANT'],
  },
  {
    title: 'Projects',
    href: '/dashboard/projects',
    icon: FolderKanban,
    roles: ['ADMIN', 'PARTNER', 'EMPLOYEE'],
  },
  {
    title: 'Inventory',
    href: '/dashboard/inventory',
    icon: Package,
    roles: ['ADMIN', 'INVENTORY_MANAGER', 'EMPLOYEE'],
  },
  {
    title: 'Sales',
    href: '/dashboard/sales',
    icon: ShoppingCart,
    roles: ['ADMIN', 'EMPLOYEE', 'ACCOUNTANT'],
  },
  {
    title: 'Purchases',
    href: '/dashboard/purchases',
    icon: Truck,
    roles: ['ADMIN', 'INVENTORY_MANAGER'],
  },
  {
    title: 'Finance',
    href: '/dashboard/finance',
    icon: DollarSign,
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
  },
  {
    title: 'Partners',
    href: '/dashboard/partners',
    icon: Users,
    roles: ['ADMIN', 'PARTNER'],
  },
  {
    title: 'Customers',
    href: '/dashboard/customers',
    icon: Store,
    roles: ['ADMIN', 'EMPLOYEE'],
  },
  {
    title: 'Suppliers',
    href: '/dashboard/suppliers',
    icon: Truck,
    roles: ['ADMIN', 'INVENTORY_MANAGER'],
  },
  {
    title: 'Reports',
    href: '/dashboard/reports',
    icon: BarChart3,
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
  },
  {
    title: 'Notifications',
    href: '/dashboard/notifications',
    icon: Bell,
    roles: ['ADMIN', 'PARTNER', 'EMPLOYEE', 'INVENTORY_MANAGER', 'ACCOUNTANT'],
  },
  {
    title: 'Users',
    href: '/dashboard/users',
    icon: UserCog,
    roles: ['ADMIN'],
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: Settings,
    roles: ['ADMIN', 'PARTNER', 'EMPLOYEE', 'INVENTORY_MANAGER', 'ACCOUNTANT'],
  },
  {
    title: 'Cash Sales',
    href: '/dashboard/cash-sales',
    icon: Receipt,
    roles: ['ADMIN', 'EMPLOYEE'],
  },
  {
    title: 'Accounts',
    href: '/dashboard/accounts',
    icon: Wallet,
    roles: ['ADMIN', 'ACCOUNTANT'],
  },
  {
    title: 'Transfers',
    href: '/dashboard/transfers',
    icon: ArrowLeftRight,
    roles: ['ADMIN', 'ACCOUNTANT'],
  },
  {
    title: 'Expenditures',
    href: '/dashboard/expenditures',
    icon: TrendingDown,
    roles: ['ADMIN', 'ACCOUNTANT'],
  },
  {
    title: 'Daybook',
    href: '/dashboard/daybook',
    icon: BookOpen,
    roles: ['ADMIN', 'ACCOUNTANT', 'PARTNER'],
  },
  {
    title: 'Backup',
    href: '/dashboard/backup',
    icon: HardDrive,
    roles: ['ADMIN'],
  },
];

// ─── Income Categories ──────────────────────────────────────────────
export const INCOME_CATEGORIES = [
  { value: 'PROJECT_PAYMENT', label: 'Project Payment', icon: FolderKanban },
  { value: 'COMPONENT_SALE', label: 'Component Sale', icon: ShoppingCart },
  { value: 'INVESTMENT', label: 'Investment', icon: TrendingUp },
  { value: 'OTHER_INCOME', label: 'Other Income', icon: Wallet },
];

// ─── Expense Categories ─────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  { value: 'COMPONENT_PURCHASE', label: 'Component Purchase', icon: Package },
  { value: 'SALARY', label: 'Salary', icon: Users },
  { value: 'UTILITY', label: 'Utility Bills', icon: CreditCard },
  { value: 'RENT', label: 'Rent', icon: Banknote },
  { value: 'TRAVEL', label: 'Travel', icon: Truck },
  { value: 'HARDWARE', label: 'Hardware/Tools', icon: Settings },
  { value: 'SOFTWARE', label: 'Software', icon: FileText },
  { value: 'MARKETING', label: 'Marketing', icon: TrendingUp },
  { value: 'SHIPPING', label: 'Shipping', icon: Truck },
  { value: 'TAX', label: 'Tax', icon: Receipt },
  { value: 'OTHER_EXPENSE', label: 'Other Expense', icon: AlertTriangle },
  { value: 'RENT_SHOP', label: 'Shop Rent', icon: Building2 },
  { value: 'RENT_GODOWN', label: 'Godown/Storage Rent', icon: Warehouse },
  { value: 'DAILY_MISC', label: 'Daily Miscellaneous', icon: Receipt },
];

// ─── Expenditure Categories ─────────────────────────────────────────
export const EXPENDITURE_CATEGORIES = [
  { value: 'RENT_SHOP', label: 'Shop Rent', icon: Building2 },
  { value: 'RENT_GODOWN', label: 'Godown/Storage Rent', icon: Warehouse },
  { value: 'SALARY', label: 'Salaries', icon: Users },
  { value: 'UTILITY', label: 'Utility Bills', icon: CreditCard },
  { value: 'DAILY_MISC', label: 'Daily Miscellaneous', icon: Receipt },
  { value: 'TRAVEL', label: 'Travel', icon: Truck },
  { value: 'MAINTENANCE', label: 'Maintenance', icon: Settings },
  { value: 'OTHER_EXPENSE', label: 'Other Expense', icon: AlertTriangle },
];

// ─── Payment Methods ────────────────────────────────────────────────
export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'NAYAPAY', label: 'NayaPay' },
  { value: 'SADAPAY', label: 'SadaPay' },
];

// ─── Project Statuses ───────────────────────────────────────────────
export const PROJECT_STATUSES = [
  { value: 'PLANNING', label: 'Planning', color: 'bg-slate-500' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: 'bg-blue-500' },
  { value: 'COMPLETED', label: 'Completed', color: 'bg-emerald-500' },
  { value: 'ON_HOLD', label: 'On Hold', color: 'bg-amber-500' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'bg-red-500' },
];

// ─── Component Categories ───────────────────────────────────────────
export const DEFAULT_COMPONENT_CATEGORIES = [
  { name: 'Resistors', icon: '🔌', color: '#EF4444' },
  { name: 'Capacitors', icon: '💾', color: '#3B82F6' },
  { name: 'Inductors', icon: '🧲', color: '#10B981' },
  { name: 'Diodes', icon: '💡', color: '#F59E0B' },
  { name: 'Transistors', icon: '🔹', color: '#8B5CF6' },
  { name: 'ICs & Chips', icon: '🧠', color: '#EC4899' },
  { name: 'Microcontrollers', icon: '🖥️', color: '#6366F1' },
  { name: 'Sensors', icon: '📡', color: '#14B8A6' },
  { name: 'Connectors', icon: '🔗', color: '#F97316' },
  { name: 'Cables & Wires', icon: '🔌', color: '#84CC16' },
  { name: 'PCB Boards', icon: '📋', color: '#06B6D4' },
  { name: 'Power Supplies', icon: '⚡', color: '#E11D48' },
  { name: 'LEDs & Displays', icon: '💡', color: '#D946EF' },
  { name: 'Motors', icon: '⚙️', color: '#0EA5E9' },
  { name: 'Breadboards', icon: '📐', color: '#F43F5E' },
  { name: 'Tools', icon: '🔧', color: '#64748B' },
  { name: 'Kits', icon: '📦', color: '#78716C' },
  { name: 'Other', icon: '📌', color: '#94A3B8' },
];

// ─── User Roles ─────────────────────────────────────────────────────
export const USER_ROLES = [
  { value: 'ADMIN', label: 'Admin - Full Access' },
  { value: 'PARTNER', label: 'Partner - Dashboard & Reports' },
  { value: 'EMPLOYEE', label: 'Employee - Projects & Sales' },
  { value: 'INVENTORY_MANAGER', label: 'Inventory Manager - Stock Control' },
  { value: 'ACCOUNTANT', label: 'Accountant - Finance & Reports' },
];

// ─── Company Info (configurable) ────────────────────────────────────
export const COMPANY_INFO = {
  name: 'Electronics Startup ERP',
  shortName: 'ES-ERP',
  tagline: 'IoT & Electronics Solutions',
  address: 'Pakistan',
  phone: '',
  email: '',
  website: '',
  currency: 'PKR',
  currencySymbol: 'Rs.',
  taxRate: 0, // GST percentage
};