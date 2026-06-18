# Architecture Document — Electronics Startup ERP

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Directory Structure](#directory-structure)
4. [Database Design](#database-design)
5. [Authentication & Authorization](#authentication--authorization)
6. [API Design](#api-design)
7. [Component Architecture](#component-architecture)
8. [Data Flow Patterns](#data-flow-patterns)
9. [Report Generation](#report-generation)
10. [Deployment Architecture](#deployment-architecture)
11. [Security Considerations](#security-considerations)

---

## Overview

The Electronics Startup ERP is a **full-stack Next.js 16 application** using the **App Router** paradigm. It follows a **server/client component split** pattern where:

- **Server Components** (`page.tsx`) handle data fetching, authentication checks, and pass serialized data to client components via props
- **Client Components** (`*-client.tsx`) handle all interactivity — forms, tables, modals, search, filtering, and mutations

The system is designed for **electronics/IoT hardware startups in Pakistan** with support for local payment methods (JazzCash, EasyPaisa, NayaPay, SadaPay), Urdu-compatible currency formatting, and Pakistani business workflows.

---

## Technology Stack

### Core

| Layer       | Technology             | Version | Purpose                                  |
| ----------- | ---------------------- | ------- | ---------------------------------------- |
| Framework   | Next.js                | 16.2.6  | App Router, SSR, API routes              |
| Language    | TypeScript             | 5.x     | Type safety                              |
| Database    | SQLite / PostgreSQL    | —       | Dev: SQLite via libsql, Prod: PostgreSQL |
| ORM         | Prisma                 | 7.8.0   | Schema, migrations, queries              |
| ORM Adapter | @prisma/adapter-libsql | 7.8.0   | SQLite driver for Prisma v7              |

### Frontend

| Package                  | Version | Purpose                  |
| ------------------------ | ------- | ------------------------ |
| React                    | 19.2.4  | UI library               |
| Tailwind CSS             | 4.x     | Utility-first CSS        |
| next-themes              | 0.4.6   | Dark/light mode          |
| Radix UI                 | various | Accessible UI primitives |
| Recharts                 | 3.8.1   | Dashboard charts         |
| Lucide React             | 1.16.0  | Icon library             |
| Sonner                   | 2.0.7   | Toast notifications      |
| class-variance-authority | 0.7.1   | Component variants       |
| clsx + tailwind-merge    | —       | Class merging utilities  |

### Backend / Auth

| Package         | Version | Purpose                          |
| --------------- | ------- | -------------------------------- |
| jose            | 6.2.3   | JWT creation & verification      |
| bcryptjs        | 3.0.3   | Password hashing                 |
| zod             | 4.4.3   | Request/response validation      |
| react-hook-form | 7.76.0  | Form state management (optional) |

### Reports & Exports

| Package             | Version | Purpose                       |
| ------------------- | ------- | ----------------------------- |
| ExcelJS             | 4.4.0   | Excel report generation       |
| PDFKit              | —       | PDF invoice/report generation |
| @react-pdf/renderer | 4.5.1   | React PDF components          |

---

## Directory Structure

```
crm/
├── prisma/
│   ├── schema.prisma           # 20 models, 7 enums — single source of truth
│   ├── seed.ts                 # Dev seed: 5 users, 16 categories, 4 suppliers, 5 customers, 15 components
│   └── migrations/             # Auto-generated Prisma migrations
│
├── src/
│   ├── middleware.ts            # JWT verification + RBAC route protection
│   │
│   ├── app/
│   │   ├── globals.css          # Tailwind v4 imports + CSS variables + keyframes
│   │   ├── layout.tsx           # Root layout (html, body, font)
│   │   ├── page.tsx             # Landing page (redirects to /dashboard or /login)
│   │   │
│   │   ├── (auth)/              # Route group — no dashboard layout
│   │   │   ├── login/page.tsx   # Login with email/password
│   │   │   └── register/page.tsx # User registration
│   │   │
│   │   ├── (dashboard)/         # Route group — wrapped in Shell layout
│   │   │   ├── layout.tsx       # Shell provider (sidebar + header + footer)
│   │   │   ├── page.tsx         # Dashboard server component
│   │   │   ├── dashboard-client.tsx  # Charts, stats, recent activity
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx     # Project list (server)
│   │   │   │   ├── projects-client.tsx  # Filterable project list
│   │   │   │   ├── new/
│   │   │   │   │   ├── page.tsx         # Server: fetch users+components
│   │   │   │   │   └── new-project-client.tsx  # Multi-step create form
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx         # Server: fetch project detail
│   │   │   │       └── project-detail-client.tsx  # Detail view + edit
│   │   │   ├── inventory/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── inventory-client.tsx  # Full CRUD table
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx
│   │   │   │       └── inventory-detail-client.tsx  # SKU history, stats
│   │   │   ├── sales/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── sales-client.tsx  # Filterable sales table
│   │   │   │   └── new/
│   │   │   │       ├── page.tsx
│   │   │   │       └── new-sale-client.tsx  # Sale creation with item rows
│   │   │   ├── purchases/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── purchases-client.tsx
│   │   │   │   └── new/
│   │   │   │       ├── page.tsx
│   │   │   │       └── new-purchase-client.tsx  # PO creation
│   │   │   ├── finance/
│   │   │   │   ├── page.tsx
│   │   │   │   └── finance-client.tsx  # Income/expense ledger + stats
│   │   │   ├── partners/
│   │   │   │   ├── page.tsx
│   │   │   │   └── partners-client.tsx  # Partner CRUD + share calc
│   │   │   ├── customers/
│   │   │   │   ├── page.tsx
│   │   │   │   └── customers-client.tsx  # Customer CRUD
│   │   │   ├── suppliers/
│   │   │   │   ├── page.tsx
│   │   │   │   └── suppliers-client.tsx  # Supplier CRUD
│   │   │   ├── reports/
│   │   │   │   └── page.tsx  # Client-only: 6 report types + filters + preview/export
│   │   │   ├── notifications/
│   │   │   │   ├── page.tsx
│   │   │   │   └── notifications-client.tsx  # Read/unread split view
│   │   │   ├── users/
│   │   │   │   ├── page.tsx
│   │   │   │   └── users-client.tsx  # Admin user management
│   │   │   └── settings/
│   │   │       ├── page.tsx
│   │   │       └── settings-client.tsx  # Profile + password
│   │   │
│   │   └── api/                 # REST API — all route handlers
│   │       ├── auth/            # login, logout, register, me
│   │       ├── dashboard/       # Dashboard stats aggregation
│   │       ├── projects/        # CRUD + [id] detail
│   │       ├── inventory/       # CRUD + [id] detail
│   │       ├── sales/           # CRUD + [id] detail
│   │       ├── purchases/       # CRUD + [id] detail
│   │       ├── finance/         # CRUD + [id]
│   │       ├── partners/        # CRUD + [id]
│   │       ├── customers/       # CRUD + [id]
│   │       ├── suppliers/       # CRUD + [id]
│   │       ├── users/           # List + [id] CRUD
│   │       ├── notifications/   # List + mark read
│   │       └── reports/         # 6 sub-routes: profit-loss, sales, inventory, purchases, projects, customers
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── shell.tsx        # Root layout wrapper: ThemeProvider + Sidebar + Header + Toaster
│   │   │   ├── sidebar.tsx      # Collapsible sidebar with role-filtered nav
│   │   │   └── header.tsx       # Top bar: search, notifications, user menu
│   │   │
│   │   ├── shared/
│   │   │   ├── page-header.tsx  # Page title + description + action buttons
│   │   │   ├── data-table.tsx   # Generic table component (not used everywhere, some pages inline)
│   │   │   ├── confirm-dialog.tsx    # Delete confirmation modal
│   │   │   ├── empty-state.tsx       # "No data" placeholder
│   │   │   ├── search-input.tsx      # Search bar wrapper
│   │   │   └── stats-cards.tsx       # Stat card grid
│   │   │
│   │   └── ui/                  # Shadcn/ui-style primitives
│   │       ├── button.tsx       # Multi-variant button (ghost, outline, destructive, etc.)
│   │       ├── input.tsx        # Text input
│   │       ├── card.tsx         # Card, CardHeader, CardContent, CardFooter, CardTitle
│   │       ├── dialog.tsx       # Modal dialog with portal
│   │       ├── select.tsx       # Custom select dropdown
│   │       ├── table.tsx        # Table, TableHeader, TableBody, TableRow, etc.
│   │       ├── badge.tsx        # Status badges
│   │       ├── avatar.tsx       # User avatars
│   │       ├── dropdown-menu.tsx    # Dropdown menus
│   │       ├── scroll-area.tsx      # Scrollable containers
│   │       ├── label.tsx
│   │       ├── textarea.tsx
│   │       └── ...others
│   │
│   ├── lib/
│   │   ├── auth.ts             # JWT: createToken(), verifyToken(), getAuthUser(), requireRole()
│   │   ├── prisma.ts           # PrismaClient singleton (libsql adapter for dev)
│   │   ├── utils.ts            # formatCurrency (ur-PK), formatDate, paginate, generateSKU, etc.
│   │   ├── constants.ts        # SIDEBAR_NAV, categories, payment methods, statuses
│   │   ├── validations.ts      # Zod schemas for API validation
│   │   ├── notifications.ts    # createNotification() helpers
│   │   ├── pdf-generator.ts    # generateInvoicePDF(), generateProjectReport(), generateFinancialReport()
│   │   └── excel-generator.ts  # generateInventoryReport(), generateSalesReport(), generateFinanceReport()
│   │
│   └── types/
│       └── index.ts            # All TypeScript interfaces
│
├── public/                     # Static assets (icons, images)
├── package.json                # Dependencies & scripts
├── tsconfig.json               # TypeScript config
├── next.config.ts              # Next.js configuration
├── postcss.config.mjs          # PostCSS (Tailwind v4)
├── prisma.config.ts            # Prisma configuration
└── .env                        # Environment variables
```

---

## Database Design

### Entity Relationship Overview

The database has **20 models** organized into these functional domains:

```
┌─────────────────────────────────────────────────────────┐
│                    Auth & Users                          │
│  User ◄── Account, Session, Notification                │
├─────────────────────────────────────────────────────────┤
│                   Project Management                     │
│  Project ◄── TeamMember (→ User)                        │
│  Project ◄── ProjectComponent (→ Component)              │
│  Project ◄── Attachment                                  │
├─────────────────────────────────────────────────────────┤
│                   Inventory                              │
│  ComponentCategory ◄── Component                        │
│  Component ◄── InventoryHistory                         │
│  Component → Supplier (optional)                         │
├─────────────────────────────────────────────────────────┤
│                   Sales                                  │
│  Customer ◄── Sale                                      │
│  Sale ◄── SaleItem (→ Component)                        │
│  Sale → User (processor)                                │
├─────────────────────────────────────────────────────────┤
│                   Purchases                              │
│  Supplier ◄── Purchase                                  │
│  Purchase ◄── PurchaseItem (→ Component)                │
│  Purchase → User (creator)                              │
├─────────────────────────────────────────────────────────┤
│                   Finance                                │
│  Finance → User                                          │
├─────────────────────────────────────────────────────────┤
│                   Partners                               │
│  Partner (standalone)                                    │
├─────────────────────────────────────────────────────────┤
│                   Support                                │
│  Invoice, Setting                                        │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **SQLite for dev, PostgreSQL for prod**: The adapter pattern via `@prisma/adapter-libsql` enables SQLite in development without changing Prisma queries. Switching to PostgreSQL requires only changing the provider in `schema.prisma` and removing the adapter from `prisma.ts`.

2. **Float for monetary values**: All financial amounts use `Float`. For production, consider migrating to `Decimal` for precision.

3. **Snapshot pattern**: `ProjectComponent`, `SaleItem`, and `PurchaseItem` store `unitCost` and `unitPrice` at the time of the transaction — these are snapshots, not live references to the current Component price. This ensures historical accuracy.

4. **Soft references via optional IDs**: `Sale.customerId` is optional (walk-in sales), `Purchase.supplierId` is required. `Finance.referenceId` is an optional string that can link to any entity.

5. **Calculated fields**: `Project.profit`, `Project.totalCost`, `Project.remainingPayment`, `Partner.currentBalance` are computed in application code, not in the database. They should be recalculated on relevant mutations.

6. **Inventory tracking**: `Component` tracks `totalPurchased`, `totalUsed`, `totalSold`, `totalDamaged` as aggregate counters. `InventoryHistory` provides the detailed audit trail.

### Enum Values

```prisma
UserRole          ADMIN | PARTNER | EMPLOYEE | INVENTORY_MANAGER | ACCOUNTANT
ProjectStatus     PLANNING | IN_PROGRESS | COMPLETED | ON_HOLD | CANCELLED
PaymentStatus     PAID | PARTIAL | PENDING | OVERDUE
TransactionType   INCOME | EXPENSE
IncomeCategory    PROJECT_PAYMENT | COMPONENT_SALE | INVESTMENT | OTHER_INCOME
ExpenseCategory   COMPONENT_PURCHASE | SALARY | UTILITY | RENT | TRAVEL |
                  HARDWARE | SOFTWARE | MARKETING | SHIPPING | TAX | OTHER_EXPENSE
NotificationType  LOW_STOCK | PENDING_PAYMENT | PROJECT_DEADLINE |
                  SUPPLIER_DUE | OVERDUE_INVOICE | SYSTEM
```

---

## Authentication & Authorization

### Flow

```
1. User submits email + password → POST /api/auth/login
2. Server validates credentials, creates JWT with { userId, email, role }
3. JWT set as httpOnly, secure, sameSite=lax cookie named "auth-token"
4. Every subsequent request → middleware.ts intercepts
5. Middleware calls verifyToken(), extracts payload, allows/rejects
6. API routes call getAuthUser() to get the current user from the cookie
7. Role-gated routes use requireRole() wrapper
```

### Key Files

- [`src/lib/auth.ts`](src/lib/auth.ts) — `createToken()`, `verifyToken()`, `getAuthUser()`, `requireRole()`
- [`src/middleware.ts`](src/middleware.ts) — Route matcher: protects `/dashboard/*` and `/api/*` (except `/api/auth/*`)
- [`src/app/api/auth/login/route.ts`](src/app/api/auth/login/route.ts) — Sets cookie on successful login
- [`src/app/api/auth/logout/route.ts`](src/app/api/auth/logout/route.ts) — Clears cookie, redirects to `/login`

### RBAC Matrix

| Route Group   | ADMIN | PARTNER | EMPLOYEE | INVENTORY_MANAGER | ACCOUNTANT |
| ------------- | ----- | ------- | -------- | ----------------- | ---------- |
| Dashboard     | ✓     | ✓       | ✓        | ✓                 | ✓          |
| Projects      | ✓     | ✓       | ✓        | ✗                 | ✗          |
| Inventory     | ✓     | ✗       | ✓        | ✓                 | ✗          |
| Sales         | ✓     | ✗       | ✓        | ✗                 | ✓          |
| Purchases     | ✓     | ✗       | ✗        | ✓                 | ✗          |
| Finance       | ✓     | ✓       | ✗        | ✗                 | ✓          |
| Partners      | ✓     | ✓       | ✗        | ✗                 | ✗          |
| Customers     | ✓     | ✗       | ✓        | ✗                 | ✗          |
| Suppliers     | ✓     | ✗       | ✗        | ✓                 | ✗          |
| Reports       | ✓     | ✓       | ✗        | ✗                 | ✓          |
| Notifications | ✓     | ✓       | ✓        | ✓                 | ✓          |
| Users         | ✓     | ✗       | ✗        | ✗                 | ✗          |
| Settings      | ✓     | ✓       | ✓        | ✓                 | ✓          |

---

## API Design

### Conventions

- All routes are under `/api/`
- Each resource has:
  - `GET /api/{resource}` — List (with optional `?search=`, `?page=`, `?limit=`)
  - `POST /api/{resource}` — Create
  - `GET /api/{resource}/[id]` — Get by ID
  - `PUT /api/{resource}/[id]` — Update
  - `DELETE /api/{resource}/[id]` — Delete
- All handlers are `async function GET/POST/PUT/DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> })`
- Params are awaited (`const { id } = await params`) per Next.js 16 convention
- Auth is checked at the top of each handler via `getAuthUser()`
- Role checks use `requireRole()` wrapper or inline checks
- Validation uses Zod schemas from [`src/lib/validations.ts`](src/lib/validations.ts)
- Responses: `NextResponse.json({ success: true, data })` or `{ success: false, error: "message" }`

### API Routes Inventory

| Route                      | Methods          | Auth   | Description                          |
| -------------------------- | ---------------- | ------ | ------------------------------------ |
| `/api/auth/login`          | POST             | Public | Login, returns JWT cookie            |
| `/api/auth/logout`         | POST             | Public | Clears cookie                        |
| `/api/auth/register`       | POST             | Public | Registration                         |
| `/api/auth/me`             | GET              | User   | Current user profile                 |
| `/api/dashboard`           | GET              | User   | Aggregated dashboard stats           |
| `/api/projects`            | GET, POST        | User   | List/create projects                 |
| `/api/projects/[id]`       | GET, PUT, DELETE | User   | Project CRUD                         |
| `/api/inventory`           | GET, POST        | User   | List/create components               |
| `/api/inventory/[id]`      | GET, PUT, DELETE | User   | Component CRUD                       |
| `/api/sales`               | GET, POST        | User   | List/create sales                    |
| `/api/sales/[id]`          | GET, PUT, DELETE | User   | Sale CRUD                            |
| `/api/purchases`           | GET, POST        | User   | List/create purchases                |
| `/api/purchases/[id]`      | GET, PUT, DELETE | User   | Purchase CRUD                        |
| `/api/finance`             | GET, POST        | User   | List/create transactions             |
| `/api/finance/[id]`        | GET, PUT, DELETE | User   | Transaction CRUD                     |
| `/api/partners`            | GET, POST        | Admin  | List/create partners                 |
| `/api/partners/[id]`       | GET, PUT, DELETE | Admin  | Partner CRUD                         |
| `/api/customers`           | GET, POST        | User   | List/create customers                |
| `/api/customers/[id]`      | GET, PUT, DELETE | User   | Customer CRUD                        |
| `/api/suppliers`           | GET, POST        | User   | List/create suppliers                |
| `/api/suppliers/[id]`      | GET, PUT, DELETE | User   | Supplier CRUD                        |
| `/api/users`               | GET, POST        | Admin  | List/create users                    |
| `/api/users/[id]`          | GET, PUT, DELETE | User   | User profile CRUD                    |
| `/api/notifications`       | GET, PUT         | User   | List + mark read                     |
| `/api/reports/profit-loss` | GET              | User   | P&L with optional date range + Excel |
| `/api/reports/sales`       | GET              | User   | Sales report + Excel                 |
| `/api/reports/inventory`   | GET              | User   | Inventory report + Excel             |
| `/api/reports/purchases`   | GET              | User   | Purchases report + Excel             |
| `/api/reports/projects`    | GET              | User   | Projects report + Excel              |
| `/api/reports/customers`   | GET              | User   | Customers report + Excel             |

---

## Component Architecture

### Pattern: Server/Client Split

Every page follows this pattern:

```typescript
// page.tsx (Server Component)
export default async function CustomersPage() {
  const user = await getAuthUser();
  const customers = await prisma.customer.findMany({
    include: { _count: { select: { sales: true } } }
  });
  return <CustomersClient customers={JSON.parse(JSON.stringify(customers))} />;
}

// customers-client.tsx (Client Component)
"use client";
export default function CustomersClient({ customers: initialCustomers }: Props) {
  const [customers, setCustomers] = useState(initialCustomers);
  // ... interactive UI with fetch() mutations → window.location.reload()
}
```

The `JSON.parse(JSON.stringify())` pattern is used to serialize Prisma Date objects to plain strings for client component props.

### Shared Component Library

| Component       | Props                                                  | Used By                |
| --------------- | ------------------------------------------------------ | ---------------------- |
| `PageHeader`    | `title`, `description?`, `icon?`, `actions?`           | All pages              |
| `ConfirmDialog` | `open`, `onClose`, `onConfirm`, `title`, `description` | All delete operations  |
| `EmptyState`    | `icon?`, `title`, `description`                        | Empty list states      |
| `SearchInput`   | `value`, `onChange`, `placeholder?`                    | List pages with search |
| `StatsCards`    | `items: StatCard[]`                                    | Dashboard, list pages  |

### UI Primitives (`src/components/ui/`)

These follow the shadcn/ui pattern — each is a thin wrapper around a Radix UI primitive with Tailwind classes:

- **Button**: `variant` (default, destructive, outline, secondary, ghost, link), `size` (default, sm, lg, icon)
- **Input**: Standard text input with focus ring
- **Card**: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- **Dialog**: `Dialog`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogContent`, `DialogFooter`
- **Select**: Custom implementation with `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`
- **Table**: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`, `TableHead`
- **Badge**: `variant` (default, secondary, destructive, outline)
- **Avatar**: `Avatar`, `AvatarImage`, `AvatarFallback`

### Layout Components

- **`Shell`** — Top-level layout wrapper: `ThemeProvider` → `Sidebar` + `Header` + `<main>{children}</main>` + `Footer` + `Toaster`
- **`Sidebar`** — Collapsible sidebar with `SIDEBAR_NAV` from constants, role-filtered, with expandable sections
- **`Header`** — Sticky top bar with search, notification bell (with unread count badge), user avatar dropdown

---

## Data Flow Patterns

### Read Path (Page Load)

```
Browser → GET /dashboard/customers
  → middleware.ts: verify auth-token cookie
  → page.tsx (server): getAuthUser() → prisma.customer.findMany()
  → Serialize: JSON.parse(JSON.stringify(data))
  → Render: <CustomersClient customers={data} />
  → Browser: Interactive table with search, filter, edit, delete
```

### Write Path (Mutation)

```
User clicks "Save" in Dialog
  → customers-client.tsx: handleCreate()
  → fetch('/api/customers', { method: 'POST', body: JSON.stringify(form) })
  → route.ts: getAuthUser() → Zod validation → prisma.customer.create()
  → Response: { success: true, data: newCustomer }
  → window.location.reload() // Hard refresh to get fresh server data
```

### Dashboard Data Aggregation

```
Dashboard page.tsx:
  → Multiple parallel Prisma queries:
    - count projects, users, components, customers, suppliers
    - sum finance income/expense (last 30 days)
    - monthly revenue/expense aggregation
    - top 5 components by usage
    - recent 5 sales with customer info
    - recent 5 projects with profit data
  → Serialize all
  → Pass to DashboardClient for chart rendering
```

---

## Report Generation

### Architecture

```
Reports Page (client)
  ├── Select report type + date range
  ├── Click "Preview" → fetch JSON → render stat cards
  ├── Click "Export Excel" → fetch blob → auto-download .xlsx
  └── Click "Export PDF" → fetch blob → auto-download .pdf
```

### Excel Generation

Three reports use the shared **ExcelJS** generators in [`src/lib/excel-generator.ts`](src/lib/excel-generator.ts):

- `generateInventoryReport(items)` — Component list with category, SKU, quantity, cost, value
- `generateSalesReport(sales)` — Sales with customer, items, payment method, profit
- `generateFinanceReport(transactions)` — Income/expense ledger with running balance

Three reports (purchases, projects, customers) build ExcelJS workbooks inline in their API routes.

All Excel exports:

1. Create an `ExcelJS.Workbook`
2. Add worksheet with styled headers (bold, colored)
3. Populate rows from Prisma data
4. Auto-fit column widths
5. Write to `Buffer`
6. Return with headers: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

### PDF Generation

Uses **PDFKit** in [`src/lib/pdf-generator.ts`](src/lib/pdf-generator.ts):

- `generateInvoicePDF(invoice)` — Professional invoice with logo, company info, line items, totals
- `generateProjectReport(project, components)` — Project summary with component usage
- `generateFinancialReport(summary)` — Period financial summary

All PDF generators return `Promise<Buffer>`.

---

## Deployment Architecture

### Development

```
SQLite (dev.db) ←→ Prisma (libsql adapter) ←→ Next.js dev server (localhost:3000)
```

### Production (Recommended)

```
┌─────────────────────────────────────────┐
│              Vercel Edge                 │
│  ┌───────────────────────────────────┐  │
│  │  Next.js App (SSR/API Routes)     │  │
│  └──────────────┬────────────────────┘  │
│                 │                         │
│  ┌──────────────▼────────────────────┐  │
│  │  PostgreSQL (Vercel Postgres or   │  │
│  │  Neon/Supabase/Railway)           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Production (Self-Hosted)

```
┌─────────────────────────────────────────┐
│         Ubuntu/Debian VPS                │
│  ┌───────────────────────────────────┐  │
│  │  PM2: Next.js (npm start)         │  │
│  │  Port 3000                         │  │
│  └──────────────┬────────────────────┘  │
│                 │                         │
│  ┌──────────────▼────────────────────┐  │
│  │  Nginx Reverse Proxy              │  │
│  │  (SSL via Let's Encrypt)          │  │
│  │  Port 80/443 → localhost:3000     │  │
│  └──────────────┬────────────────────┘  │
│                 │                         │
│  ┌──────────────▼────────────────────┐  │
│  │  PostgreSQL 15+                   │  │
│  │  Port 5432 (localhost only)       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### SQLite → PostgreSQL Migration

1. Change `provider = "sqlite"` to `provider = "postgresql"` in [`prisma/schema.prisma`](prisma/schema.prisma)
2. Remove `@prisma/adapter-libsql` import and usage from [`src/lib/prisma.ts`](src/lib/prisma.ts)
3. Update `DATABASE_URL` to PostgreSQL connection string
4. Run `npx prisma migrate deploy`
5. Review any SQLite-specific queries (auto-increment, date handling) and adjust for PostgreSQL

---

## Security Considerations

| Area                 | Implementation                                           |
| -------------------- | -------------------------------------------------------- |
| **Authentication**   | JWT with httpOnly cookies (not accessible to JavaScript) |
| **Password Storage** | bcryptjs with 12 salt rounds                             |
| **CSRF Protection**  | SameSite=Lax cookies + origin checking                   |
| **XSS Prevention**   | React's default escaping + no dangerouslySetInnerHTML    |
| **SQL Injection**    | Prisma ORM parameterized queries                         |
| **Input Validation** | Zod schemas on all API endpoints                         |
| **Authorization**    | Role-based middleware + inline role checks in handlers   |
| **Rate Limiting**    | Not implemented — consider adding for production         |
| **CSP Headers**      | Not configured — recommend adding for production         |
| **HTTPS**            | Enforced via Vercel/Nginx in production                  |

### Environment Variables

Sensitive values should NEVER be committed:

```
DATABASE_URL  → Database connection (contains credentials in prod)
JWT_SECRET    → Must be strong random string (≥ 256 bits)
```

The provided `.env` file contains development-only values. Replace all secrets before production deployment.

---

## Further Reading

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Prisma v7 Documentation](https://www.prisma.io/docs)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [Recharts Documentation](https://recharts.org/en-US/guide)
- [ExcelJS Documentation](https://github.com/exceljs/exceljs#readme)
- [PDFKit Documentation](https://pdfkit.org/docs/)

---

_Document version: 1.0 — Last updated: May 2026_
