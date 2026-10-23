# Pakistan CRM (PM-ERP · Paper Mill System)

Business management for a Pakistani paper and packaging business: stock, sales, purchases, customer and supplier accounts, double-entry books, printing-press work, cash and bank, reports and backups. It runs as a website or as a Windows desktop app that keeps working without internet and syncs when the connection returns.

Built with **Next.js 16** (App Router, Turbopack), **Prisma 7** with **libSQL/SQLite**, **Tailwind CSS 4**, and a **Tauri 2** desktop shell.

> **Where things stand:** see [PROJECT_LOG.md](PROJECT_LOG.md) (current state, open items, change history) and the reports in [`audit-reports/`](audit-reports/). The reports analyse the legacy business database, so they are kept on the owner's computer and are not in this repository; links to them work only in the local copy. Nothing has been deployed to production yet.

---

## Quick start (development, Windows)

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser   # once, so npm scripts can run
npm install
npm run dev
```

Open <http://localhost:3000>. The database and secrets come from **`.env.local`** (not committed):

```env
DATABASE_URL="file:./crm.db"
JWT_SECRET="<a long random value>"
CRM_AUTO_MIGRATE="1"
```

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

- `crm.db` is the clean development and acceptance database. The first person to **Register** on an empty database becomes its administrator; after that, use **Sign in**.
- `CRM_AUTO_MIGRATE=1` brings the database up to date with `prisma/migrations` when the server starts.
- **Forgot a password?** In the project folder: `npx tsx scripts\reset-password.ts <email>`. It asks for the new password twice (hidden), takes a backup first and records the change.

> ⚠️ `dev.db`, `test.db` and `U2024-21-Oct-26-08-40.bak` are protected evidence files. Never point the app, a script or a migration at them, and never import real financial data before the acceptance tests and migration plan are approved (see [PROJECT_LOG.md §1](PROJECT_LOG.md)).

---

## Features

### Everyday screens

| Module | What it does |
|---|---|
| **Dashboard** | Sales, expenses and profit at a glance; recent activity |
| **Sales** | Bills for registered or walk-in customers. **Bills can be edited after saving**: stock, the customer's balance and Finance are corrected with the bill, the invoice number stays, and every change is kept in the bill's history. **Print** (the print window also offers *Save as PDF*) and **Download PDF**. New customers can be created from the sale screen |
| **Cash Sales** | Quick counter sales |
| **Purchases** | Purchase orders from suppliers; stock updated on receipt |
| **Inventory** | Items with SKU, stock, minimum level, sizes (length × width × GSM), weight and rate per kg, with a price calculator |
| **Customers / Suppliers** | Directories with ledgers, statements and payments |
| **Finance, Accounts, Transfers, Expenditures, Daybook** | Income and expenses, cash and bank accounts, transfers and the day book |
| **Partners** | Partner investments, profit shares and withdrawals |
| **Reports** | Profit and loss, sales, inventory, purchases, customers and projects, as PDF and Excel |
| **Notifications, Users, Settings** | Alerts; users and roles; profile and password |

### Books (double-entry accounting) — `Books` in the menu

- **Documents:** sale invoices, cash sales, purchase invoices, sale and purchase returns, stock issues, stock counts, vouchers (CRV/BRV/CPV/BPV/JV), transfers, opening balances.
- **Printing press:** send material to the press, receive printed goods (material used and printing charge), return unused material, record press losses.
- **Charges:** freight, loading, bilty and printing charges are recorded without posting; *Post as expense* posts them exactly once.
- **Controls:**
  - Stock issues, press losses and stock counts wait for an administrator's approval. The person who created one cannot approve it, unless an owner override is switched on with a reason (`scripts/approval-override.ts`); overrides are listed in a report.
  - Every change is in an append-only audit log.
- **Numbers:** official document numbers come only from the main server. Offline computers use provisional references until they sync; an office server can hold reserved number blocks.
- **Reports:** trial balance, ledgers, stock, own-approval overrides; printable documents with amounts in words.

### Offline, sync and backups

- **Offline first:** a desktop keeps working with no internet. Entries are kept locally as *Pending Sync* and sent automatically, exactly once, when the connection returns. Conflicts become *Needs review* and are never overwritten.
- **Office server (optional):** computers in one office keep sharing entries through a local server while the internet is down.
- **Backups:** automatic, encrypted (AES-256-GCM, passphrase-protected), verified backups to a folder of your choice, including unsent entries. Google Drive upload is built but must be verified with a real Google account before relying on it.
- **Restore:** a backup is checked on a separate copy first, a safety backup is taken, and nothing live changes without typed confirmation. `scripts/restore-drill.ts` proves a backup restores.
- **Several businesses on one server (optional):** one database per business (`scripts/tenant-admin.ts`).

### Windows desktop app (`desktop/`)

- **Install and run:**
  - Per-user installer; no administrator rights and no Windows service.
  - It brings its own Node.js and runs the same program on `127.0.0.1` only, on a free port.
  - Its data lives in `%APPDATA%\pk.pakistancrm.desktop`, separate from every other copy.
- **One copy per Windows user:** opening it again brings the open window back.
- **Crashes:** the local server always stops with the app, and a crash never leaves a stale lock.
- **Uninstalling never deletes business data**, even if "Delete the application data" is ticked.
- **Guides:**
  - For testers: [Report 27](audit-reports/27_DESKTOP_TESTER_GUIDE.md).
  - Building and upgrading: [Report 25 §2](audit-reports/25_OWNER_SETUP_GUIDE.md).

---

## Roles

| Role | Typical access |
|---|---|
| **Admin** | Everything, including users, approvals, backups and settings |
| **Accountant** | Sales, Finance, Accounts, Transfers, Expenditures, vouchers and ledgers, customer/supplier payments, Reports |
| **Employee** | Sales, Cash Sales, Customers and their payments; sees Inventory |
| **Inventory Manager** | Inventory, Purchases, Suppliers, stock issues and press documents |
| **Partner** | Partners; reads Sales, Customers, Finance, Daybook, ledgers and Reports |

The exact rules are in [`src/lib/permissions.ts`](src/lib/permissions.ts). Every page and API route checks them on the server.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build / production server |
| `npm test` | Unit and integration tests (Vitest, throw-away databases) |
| `npx tsc --noEmit` | Type check |
| `npm run lint` | ESLint |
| `npm run seed`, `npm run db:reset` | Sample data / reset. **Only** for a confirmed `*.scratch.db` or `*.sandbox.db` with `CRM_CONFIRM_RESET=<file name>`; refused in production |
| `npx tsx scripts/reset-password.ts <email>` | Set a new password for a forgotten account (backup first, audited) |
| `npx tsx scripts/restore-drill.ts` | Restore the latest backup into a separate copy and compare |
| `npx tsx scripts/approval-override.ts status` | Show or change the own-approval override (admin decision, audited) |
| `npx tsx scripts/tenant-admin.ts …` | Multi-business servers: create, back up, restore |
| `cd desktop && npm run build` | Build the desktop bundle and installer (needs the Rust toolchain) |
| `cd desktop && npm run smoke` | Desktop smoke test; also `node instance-test.mjs` and `node installer-test.mjs` |

---

## Project layout

```
prisma/              schema.prisma, migrations/ (applied in order), seed.ts (guarded)
src/app/(auth)/      login, register
src/app/dashboard/   screens (each: page.tsx on the server + *-client.tsx in the browser)
  accounting/        Books: documents, ledger, charges, reports, backups, sync, settings
  sales/             list, new, [id] (bill, print, PDF), [id]/edit
src/app/api/         route handlers (auth, sales, accounting, sync, backups, drive, health, …)
src/lib/
  accounting/        posting, numbering, charges, queries, setup (+ tests)
  sales/             bill.ts (create/edit a sale bill), bill-view.ts (shown/printed/PDF)
  sync/ device/      offline queue, sync engine, office server
  backup/            encrypted backups, verification, restore
  tenancy/           single or multi-business databases, migrations
  domain/            exact decimal money, amounts in words
  permissions.ts     roles and access rules
  pdf-generator.ts   PDF bills and reports (pdfkit)
src/components/      layout (shell, sidebar, header), shared, ui
scripts/             owner and maintenance scripts (see Commands)
desktop/             Tauri shell (src-tauri/), app-entry.cjs, bundle and installer build, tests
audit-reports/       audit, specifications, test results, owner guides (01–27)
PROJECT_LOG.md       running log: state, open items, history
```

---

## Configuration

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `file:<path>/crm.db` (or the computer's own database) |
| `JWT_SECRET` | yes | Signs sign-in cookies; different on every computer |
| `CRM_AUTO_MIGRATE` | recommended | `1` applies pending migrations at start-up |
| `CRM_NODE_ROLE` | for sync | `cloud` (main server), `hub` (office server) or `device` (desktop) |
| `CRM_DB_ENCRYPTION_KEY` | office server, desktop | Encrypts the local database |
| `CRM_UPSTREAM_URL`, `CRM_DEVICE_ID`, `CRM_DEVICE_CODE`, `CRM_DEVICE_SECRET`, `CRM_TENANT_ID` | office server, desktop | Where and how this computer syncs |
| `CRM_BACKUP_PASSPHRASE`, `CRM_TOKEN_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `CRM_PUBLIC_URL` | servers | Backups and Google Drive |
| `CRM_TENANCY`, `CONTROL_DATABASE_URL`, `TENANT_DB_DIR`, `TENANT_BACKUP_PASSPHRASE` | multi-business server only | One database per business |

The full table by computer type is in [Report 25 §9](audit-reports/25_OWNER_SETUP_GUIDE.md). Secrets never go into documents or the repository. The desktop app keeps its own secrets protected by Windows (DPAPI).

---

## Testing

- `npm test`: about 160 tests on throw-away databases, covering accounting rules, sync, backups, restore, permissions and sale-bill editing.
- End-to-end suites start real servers on throw-away databases: workflows, security, offline and sync, office server, backups, Google Drive (against an imitation), restore, and multi-business.
- Desktop tests run on the installed app: single instance, crash recovery, ports, isolation, install, upgrade and uninstall.
- Results and evidence: [Report 24](audit-reports/24_ACCEPTANCE_TEST_RESULTS.md). Defects: [Report 26](audit-reports/26_PHASE_COMPLETION_AND_DEFECT_REGISTER.md).

---

## Deployment

Not deployed yet. Hosting, domain and go-live are owner decisions (H-1, S-1 in [Report 25](audit-reports/25_OWNER_SETUP_GUIDE.md)). Release order, migrations, rollback and monitoring are in [Report 26, Phase 9](audit-reports/26_PHASE_COMPLETION_AND_DEFECT_REGISTER.md).

---

## License

Proprietary — all rights reserved.
