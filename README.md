# Electronics Startup ERP

TO RUN:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
npm run dev


A full-featured **ERP (Enterprise Resource Planning)** system built specifically for electronics and IoT hardware startups in Pakistan. Manages projects, inventory, sales (walk-in + registered), purchases, expense/income tracking, profit/loss, supplier/customer relationships, team members, partner profit sharing, and dashboard analytics — all in one place.

Built with **Next.js 16**, **Prisma v7**, **Tailwind CSS v4**, and **SQLite/PostgreSQL**.

---

## ✨ Features

| Module               | Description                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **📊 Dashboard**     | Revenue/expense charts, top components, project pipeline, recent sales, profit margins           |
| **📁 Projects**      | Full project lifecycle with team assignments, component usage tracking, costing & profitability  |
| **📦 Inventory**     | SKU-based component management with stock levels, low-stock alerts, purchase/sale/usage history  |
| **🛒 Sales**         | Registered customer sales + walk-in sales with JazzCash/EasyPaisa/Bank/Cash payments             |
| **📥 Purchases**     | Purchase orders from suppliers, payment tracking, inventory auto-update                          |
| **💰 Finance**       | Income & expense ledger with 6+ categories, transaction references, payment tracking             |
| **👥 Partners**      | Partner investment tracking, profit share calculations, withdrawal history                       |
| **🏪 Customers**     | Customer directory with purchase history, visit tracking, contact management                     |
| **🚚 Suppliers**     | Supplier directory with purchase history, balance due tracking, component catalog                |
| **📈 Reports**       | Profit/Loss, Sales, Inventory, Purchases, Projects, Customers — with JSON preview & Excel export |
| **🔔 Notifications** | Low stock, pending payments, project deadlines, supplier dues, overdue invoices, system alerts   |
| **👤 Users & RBAC**  | Admin, Partner, Employee, Inventory Manager, Accountant — role-based access control              |
| **⚙️ Settings**      | Profile editing, password change, system information                                             |

---

## 🏗️ Tech Stack

| Layer                | Technology                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| **Framework**        | [Next.js 16](https://nextjs.org) (App Router)                                 |
| **Language**         | TypeScript 5                                                                  |
| **Database**         | SQLite (dev) / PostgreSQL (production)                                        |
| **ORM**              | [Prisma v7](https://www.prisma.io) with `@prisma/adapter-libsql`              |
| **Auth**             | Custom JWT (via `jose`) + httpOnly cookies                                    |
| **Styling**          | [Tailwind CSS v4](https://tailwindcss.com) + `next-themes` dark mode          |
| **UI Primitives**    | [Radix UI](https://www.radix-ui.com) (Dialog, Select, Dropdown, Avatar, etc.) |
| **Charts**           | [Recharts v3](https://recharts.org)                                           |
| **Icons**            | [Lucide React](https://lucide.dev)                                            |
| **Toasts**           | [Sonner v2](https://sonner.emilkowal.ski)                                     |
| **PDF**              | [PDFKit](https://pdfkit.org)                                                  |
| **Excel**            | [ExcelJS](https://github.com/exceljs/exceljs)                                 |
| **Validation**       | [Zod v4](https://zod.dev)                                                     |
| **Password Hashing** | [bcryptjs](https://github.com/dcodeIO/bcrypt.js)                              |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### 1. Clone & Install

```bash
cd crm
npm install
```

### 2. Environment Variables

Create a `.env` file (a default one is provided):

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key-change-in-production"
NEXT_PUBLIC_APP_NAME="Electronics Startup ERP"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 3. Database Setup

```bash
# Run migrations (creates SQLite dev.db)
npx prisma migrate dev --name init

# Seed with sample data
npm run seed
```

### 4. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in.

---

## 🔑 Default Login Credentials

| Role                  | Email                   | Password   |
| --------------------- | ----------------------- | ---------- |
| **Admin**             | `admin@electronics.pk`  | `admin123` |
| **Employee**          | `ali@electronics.pk`    | `admin123` |
| **Inventory Manager** | `fatima@electronics.pk` | `admin123` |
| **Accountant**        | `usman@electronics.pk`  | `admin123` |
| **Partner**           | `ahmed@electronics.pk`  | `admin123` |

> ⚠️ **Change all passwords immediately in production.**

---

## 📁 Project Structure

```
crm/
├── prisma/
│   ├── schema.prisma          # Database schema (20 models, 7 enums)
│   ├── seed.ts                # Development seed data
│   └── migrations/            # Prisma migration files
├── src/
│   ├── app/
│   │   ├── (auth)/login/      # Login page
│   │   ├── (auth)/register/   # Registration page
│   │   ├── (dashboard)/       # All dashboard pages
│   │   │   ├── page.tsx           # Dashboard (server)
│   │   │   ├── dashboard-client.tsx
│   │   │   ├── projects/          # Project list, detail, new
│   │   │   ├── inventory/         # Inventory list, detail
│   │   │   ├── sales/             # Sales list, new sale
│   │   │   ├── purchases/         # Purchase list, new PO
│   │   │   ├── finance/           # Finance ledger
│   │   │   ├── partners/          # Partner management
│   │   │   ├── customers/         # Customer directory
│   │   │   ├── suppliers/         # Supplier directory
│   │   │   ├── reports/           # Reports page
│   │   │   ├── notifications/     # Notification center
│   │   │   ├── users/             # User management (admin)
│   │   │   └── settings/          # Profile & password
│   │   └── api/               # REST API routes
│   │       ├── auth/          # login, logout, register, me
│   │       ├── dashboard/     # Dashboard stats
│   │       ├── projects/      # CRUD + team + components
│   │       ├── inventory/     # CRUD + history
│   │       ├── sales/         # CRUD + items
│   │       ├── purchases/     # CRUD + items
│   │       ├── finance/       # CRUD
│   │       ├── partners/      # CRUD
│   │       ├── customers/     # CRUD
│   │       ├── suppliers/     # CRUD
│   │       ├── users/         # User management
│   │       ├── notifications/ # Notification CRUD
│   │       └── reports/       # P&L, sales, inventory, purchases, projects, customers
│   ├── components/
│   │   ├── layout/            # Shell, Sidebar, Header
│   │   ├── shared/            # PageHeader, DataTable, ConfirmDialog, EmptyState, SearchInput, StatsCards
│   │   └── ui/                # Button, Input, Card, Dialog, Select, Table, Badge, etc.
│   ├── lib/
│   │   ├── auth.ts            # JWT auth utilities
│   │   ├── prisma.ts          # Prisma singleton
│   │   ├── utils.ts           # formatCurrency, formatDate, paginate, etc.
│   │   ├── constants.ts       # Navigation, categories, payment methods
│   │   ├── validations.ts     # Zod schemas
│   │   ├── notifications.ts   # Notification helpers
│   │   ├── pdf-generator.ts   # Invoice/Report PDF generation
│   │   └── excel-generator.ts # Report Excel generation
│   ├── types/index.ts         # TypeScript type definitions
│   └── middleware.ts           # Auth middleware with RBAC
├── public/                    # Static assets
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── .env
```

---

## 🗄️ Database Schema

The system uses **20 models** and **7 enums**:

### Enums

- `UserRole` — ADMIN, PARTNER, EMPLOYEE, INVENTORY_MANAGER, ACCOUNTANT
- `ProjectStatus` — PLANNING, IN_PROGRESS, COMPLETED, ON_HOLD, CANCELLED
- `PaymentStatus` — PAID, PARTIAL, PENDING, OVERDUE
- `TransactionType` — INCOME, EXPENSE
- `IncomeCategory` — PROJECT_PAYMENT, COMPONENT_SALE, INVESTMENT, OTHER_INCOME
- `ExpenseCategory` — COMPONENT_PURCHASE, SALARY, UTILITY, RENT, TRAVEL, HARDWARE, SOFTWARE, MARKETING, SHIPPING, TAX, OTHER_EXPENSE
- `NotificationType` — LOW_STOCK, PENDING_PAYMENT, PROJECT_DEADLINE, SUPPLIER_DUE, OVERDUE_INVOICE, SYSTEM

### Models

`User`, `Account`, `Session`, `Project`, `TeamMember`, `ProjectComponent`, `ComponentCategory`, `Component`, `InventoryHistory`, `Supplier`, `Customer`, `Sale`, `SaleItem`, `Purchase`, `PurchaseItem`, `Finance`, `Partner`, `Invoice`, `Attachment`, `Notification`, `Setting`

See [`prisma/schema.prisma`](prisma/schema.prisma) for full details.

---

## 💳 Payment Methods (Pakistan)

The system supports Pakistani payment workflows:

| Method            | Use Case                                |
| ----------------- | --------------------------------------- |
| **Cash**          | Walk-in retail sales                    |
| **Bank Transfer** | Corporate/institutional payments        |
| **JazzCash**      | Mobile wallet (widely used in Pakistan) |
| **EasyPaisa**     | Mobile wallet (Telenor)                 |
| **NayaPay**       | Digital wallet / Visa                   |
| **SadaPay**       | Digital wallet / Mastercard             |

---

## 🔐 Authentication & RBAC

- **JWT-based** authentication with httpOnly cookies (`auth-token`)
- Passwords hashed with **bcryptjs** (12 rounds)
- **Middleware** protects all `/dashboard` and `/api` routes
- **Role-based access** controls sidebar navigation and API endpoints:

| Role                  | Access                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| **Admin**             | Full access — all modules, user management                                |
| **Partner**           | Dashboard, Projects, Finance, Partners, Reports, Notifications, Settings  |
| **Employee**          | Dashboard, Projects, Inventory, Sales, Customers, Notifications, Settings |
| **Inventory Manager** | Dashboard, Inventory, Purchases, Suppliers, Notifications, Settings       |
| **Accountant**        | Dashboard, Sales, Finance, Reports, Notifications, Settings               |

---

## 📊 Reports & Exports

The Reports module provides 6 report types with **JSON preview** and **Excel export** (`.xlsx`):

| Report               | Data Source                                  | Export                                |
| -------------------- | -------------------------------------------- | ------------------------------------- |
| **Profit & Loss**    | All finance transactions (income - expenses) | Excel via `generateFinanceReport()`   |
| **Sales Report**     | All sales with customer & item details       | Excel via `generateSalesReport()`     |
| **Inventory Report** | All components with stock levels & value     | Excel via `generateInventoryReport()` |
| **Purchases Report** | All POs with supplier details                | Excel (inline workbook)               |
| **Projects Report**  | All projects with revenue/cost/profit        | Excel (inline workbook)               |
| **Customers Report** | All customers with purchase totals           | Excel (inline workbook)               |

Date range filtering is supported on all reports.

---

## 📄 PDF Generation

Available PDF generators in [`src/lib/pdf-generator.ts`](src/lib/pdf-generator.ts):

- `generateInvoicePDF(invoice)` — Sales/project invoices
- `generateProjectReport(project, components)` — Project summary
- `generateFinancialReport(summary)` — Financial period summary

---

## 📦 Scripts

| Command            | Description                     |
| ------------------ | ------------------------------- |
| `npm run dev`      | Start development server        |
| `npm run build`    | Production build                |
| `npm start`        | Start production server         |
| `npm run lint`     | Run ESLint                      |
| `npm run seed`     | Seed database with sample data  |
| `npm run db:reset` | Reset DB (migrate reset + seed) |

---

## 🚢 Deployment

### Option 1: Vercel (Recommended)

1. Push your code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Set environment variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `JWT_SECRET` — Strong random string
   - `NEXT_PUBLIC_APP_URL` — Your production URL
4. Deploy

### Option 2: Manual (Ubuntu/Debian VPS)

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone & install
git clone <your-repo> /opt/crm
cd /opt/crm
npm ci

# Setup PostgreSQL
sudo apt-get install -y postgresql
sudo -u postgres createuser crm_user --pwprompt
sudo -u postgres createdb crm_db -O crm_user

# Update .env with PostgreSQL URL
# DATABASE_URL="postgresql://crm_user:password@localhost:5432/crm_db"

# Run migrations & build
npx prisma migrate deploy
npm run build

# Run with PM2
npm install -g pm2
pm2 start npm --name "crm" -- start
pm2 save
pm2 startup
```

### Option 3: Docker

```dockerfile
# Dockerfile
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:18-alpine AS production
WORKDIR /app
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t crm-erp .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/crm_db" \
  -e JWT_SECRET="your-production-secret" \
  crm-erp
```

### Migrating from SQLite to PostgreSQL

1. Update `prisma/schema.prisma` — change provider from `"sqlite"` to `"postgresql"`
2. Remove `@prisma/adapter-libsql` references from [`src/lib/prisma.ts`](src/lib/prisma.ts) (use standard PrismaClient)
3. Update `DATABASE_URL` in `.env`
4. Run `npx prisma migrate deploy`
5. Re-seed: `npm run seed`

---

## 🔧 Environment Variables Reference

| Variable               | Required | Default                   | Description                |
| ---------------------- | -------- | ------------------------- | -------------------------- |
| `DATABASE_URL`         | Yes      | `file:./dev.db`           | Database connection string |
| `JWT_SECRET`           | Yes      | (dev default)             | Secret key for JWT signing |
| `NEXT_PUBLIC_APP_NAME` | No       | `Electronics Startup ERP` | App name shown in UI       |
| `NEXT_PUBLIC_APP_URL`  | No       | `http://localhost:3000`   | Public URL of the app      |

---

## 📝 Architecture Notes

- **Server/Client split**: Each page has a server component (`page.tsx`) that fetches data and a client component (`*-client.tsx`) that renders the interactive UI. Server serializes data via `JSON.parse(JSON.stringify())`.
- **Mutations**: All client-side mutations use `fetch()` to API routes, then `window.location.reload()` to refresh data.
- **Shared components**: `PageHeader` (with `actions` prop), `DataTable`, `ConfirmDialog`, `EmptyState`, `SearchInput`, `StatsCards` are reused across all modules.
- **API pattern**: All API routes follow the Next.js App Router handler pattern with `NextRequest` and return JSON or Buffer (for Excel/PDF).
- **Auth flow**: Login → JWT token set as httpOnly cookie → middleware validates cookie on each request → API routes use `getAuthUser()` to identify the current user.

---

## 📄 License

Proprietary — All rights reserved.

---

Built with ❤️ for electronics startups in Pakistan.
