// src/lib/validations.ts - Zod validation schemas for all modules
import { z } from 'zod';

// ─── Auth ───────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().optional(),
});

// ─── Project ────────────────────────────────────────────────────────
export const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  clientEmail: z.string().email().optional().or(z.literal('')),
  startDate: z.coerce.date().optional(),
  deadline: z.coerce.date().optional().nullable(),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED']).optional(),
  laborCost: z.coerce.number().min(0).optional(),
  otherCosts: z.coerce.number().min(0).optional(),
  clientPayment: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
  color: z.string().optional(),
});

export const teamMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1, 'Role is required'),
  hours: z.coerce.number().min(0),
  rate: z.coerce.number().min(0),
});

export const projectComponentSchema = z.object({
  componentId: z.string().min(1, 'Component is required'),
  quantity: z.coerce.number().int().min(1, 'Minimum 1 unit'),
});

// ─── Component/Inventory ────────────────────────────────────────────
export const componentSchema = z.object({
  name: z.string().min(1, 'Component name is required'),
  description: z.string().optional(),
  categoryId: z.string().min(1, 'Category is required'),
  quantity: z.coerce.number().int().min(0).optional(),
  minQuantity: z.coerce.number().int().min(0).optional(),
  unitCost: z.coerce.number().min(0),
  unitPrice: z.coerce.number().min(0),
  supplierId: z.string().optional().nullable(),
  location: z.string().optional(),
  datasheetUrl: z.string().url().optional().or(z.literal('')),
  imageUrl: z.string().optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

// ─── Sale ───────────────────────────────────────────────────────────
export const saleItemSchema = z.object({
  componentId: z.string().min(1, 'Component is required'),
  quantity: z.coerce.number().int().min(1, 'Minimum 1 unit'),
  unitPrice: z.coerce.number().min(0),
});

export const saleSchema = z.object({
  customerId: z.string().optional().nullable(),
  walkInName: z.string().optional(),
  items: z.array(saleItemSchema).min(1, 'At least 1 item required'),
  discount: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
  paymentMethod: z.string().optional(),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'PENDING']).optional(),
  notes: z.string().optional(),
});

// ─── Customer ───────────────────────────────────────────────────────
export const customerSchema = z.object({
  name: z.string().min(1, 'Customer name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
});

// ─── Supplier ───────────────────────────────────────────────────────
export const supplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required'),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  taxNumber: z.string().optional(),
  notes: z.string().optional(),
});

// ─── Purchase ───────────────────────────────────────────────────────
export const purchaseItemSchema = z.object({
  componentId: z.string().min(1, 'Component is required'),
  quantity: z.coerce.number().int().min(1, 'Minimum 1 unit'),
  unitCost: z.coerce.number().min(0),
});

export const purchaseSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  items: z.array(purchaseItemSchema).min(1, 'At least 1 item required'),
  invoiceRef: z.string().optional(),
  tax: z.coerce.number().min(0).optional(),
  shipping: z.coerce.number().min(0).optional(),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'PENDING']).optional(),
  paidAmount: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

// ─── Finance ────────────────────────────────────────────────────────
export const financeSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z.string().min(1, 'Category is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  description: z.string().min(1, 'Description is required'),
  paymentMethod: z.string().optional(),
  reference: z.string().optional(),
  referenceId: z.string().optional(),
  date: z.coerce.date().optional(),
});

// ─── Partner ────────────────────────────────────────────────────────
export const partnerSchema = z.object({
  name: z.string().min(1, 'Partner name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  investmentAmount: z.coerce.number().min(0),
  profitSharePercent: z.coerce.number().min(0).max(100),
  totalWithdrawals: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

// ─── Types ──────────────────────────────────────────────────────────
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ComponentInput = z.infer<typeof componentSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type SaleInput = z.infer<typeof saleSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type FinanceInput = z.infer<typeof financeSchema>;
export type PartnerInput = z.infer<typeof partnerSchema>;