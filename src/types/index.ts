// src/types/index.ts - Complete TypeScript types for the ERP system

import type { 
  UserRole, ProjectStatus, PaymentStatus, 
  TransactionType, IncomeCategory, ExpenseCategory, NotificationType 
} from '@prisma/client';

// ─── User Types ────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  image: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}

// ─── Project Types ─────────────────────────────────────────────────
export interface ProjectData {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  startDate: Date;
  deadline: Date | null;
  status: ProjectStatus;
  laborCost: number;
  otherCosts: number;
  clientPayment: number;
  paymentStatus: PaymentStatus;
  remainingPayment: number;
  totalCost: number;
  profit: number;
  notes: string | null;
  color: string;
  userId: string;
  user?: { name: string; email: string };
  teamMembers?: TeamMemberData[];
  components?: ProjectComponentData[];
  _count?: { teamMembers: number; components: number };
  createdAt: Date;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  startDate?: Date;
  deadline?: Date;
  status?: ProjectStatus;
  laborCost?: number;
  otherCosts?: number;
  clientPayment?: number;
  notes?: string;
  color?: string;
}

export interface TeamMemberData {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  hours: number;
  rate: number;
  cost: number;
  user?: { name: string; email: string };
}

export interface ProjectComponentData {
  id: string;
  projectId: string;
  componentId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  component?: ComponentData;
}

// ─── Inventory Types ────────────────────────────────────────────────
export interface ComponentData {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string;
  category?: ComponentCategoryData;
  quantity: number;
  minQuantity: number;
  unitCost: number;
  unitPrice: number;
  supplierId: string | null;
  supplier?: SupplierData;
  location: string | null;
  datasheetUrl: string | null;
  imageUrl: string | null;
  isActive: boolean;
  totalPurchased: number;
  totalUsed: number;
  totalSold: number;
  totalDamaged: number;
}

export interface ComponentCategoryData {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
}

export interface InventoryHistoryData {
  id: string;
  componentId: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  reference: string | null;
  notes: string | null;
  createdAt: Date;
  component?: { name: string; sku: string };
}

// ─── Sales Types ────────────────────────────────────────────────────
export interface SaleData {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  customer?: CustomerData;
  walkInName: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  profit: number;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  notes: string | null;
  items?: SaleItemData[];
  user?: { name: string };
  createdAt: Date;
}

export interface SaleItemData {
  id: string;
  saleId: string;
  componentId: string;
  component?: { name: string; sku: string };
  quantity: number;
  unitCost: number;
  unitPrice: number;
  totalCost: number;
  totalPrice: number;
  profit: number;
}

// ─── Customer Types ─────────────────────────────────────────────────
export interface CustomerData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  totalPurchased: number;
  visitCount: number;
  notes: string | null;
  isActive: boolean;
}

// ─── Supplier Types ─────────────────────────────────────────────────
export interface SupplierData {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  taxNumber: string | null;
  totalPurchased: number;
  balanceDue: number;
  isActive: boolean;
}

// ─── Purchase Types ─────────────────────────────────────────────────
export interface PurchaseData {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier?: SupplierData;
  invoiceRef: string | null;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  notes: string | null;
  items?: PurchaseItemData[];
  createdAt: Date;
}

export interface PurchaseItemData {
  id: string;
  purchaseId: string;
  componentId: string;
  component?: { name: string; sku: string };
  quantity: number;
  unitCost: number;
  totalCost: number;
}

// ─── Finance Types ──────────────────────────────────────────────────
export interface FinanceData {
  id: string;
  transactionRef: string;
  type: TransactionType;
  category: string;
  amount: number;
  description: string;
  paymentMethod: string;
  reference: string | null;
  referenceId: string | null;
  date: Date;
  user?: { name: string };
}

// ─── Partner Types ──────────────────────────────────────────────────
export interface PartnerData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  investmentAmount: number;
  profitSharePercent: number;
  totalWithdrawals: number;
  currentBalance: number;
  notes: string | null;
  isActive: boolean;
}

// ─── Notification Types ─────────────────────────────────────────────
export interface NotificationData {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
}

// ─── Dashboard Types ────────────────────────────────────────────────
export interface DashboardStats {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  activeProjects: number;
  totalInventoryItems: number;
  inventoryValue: number;
  lowStockCount: number;
  pendingPayments: number;
  totalCustomers: number;
  totalSuppliers: number;
}

export interface MonthlyData {
  month: string;
  income: number;
  expense: number;
  profit: number;
}

export interface TopSellingComponent {
  componentId: string;
  name: string;
  sku: string;
  totalSold: number;
  revenue: number;
}

export interface ProjectProfitData {
  name: string;
  profit: number;
  totalCost: number;
  clientPayment: number;
}

// ─── API Response Types ─────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Form Types ─────────────────────────────────────────────────────
export interface InvoiceData {
  invoiceNumber: string;
  type: 'SALE' | 'PROJECT' | 'PURCHASE';
  referenceId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  items: InvoiceItemData[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: string;
  notes?: string;
}

export interface InvoiceItemData {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}