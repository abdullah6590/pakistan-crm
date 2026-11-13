// src/lib/classic-menu.ts - The Classic interface's menu bar (owner request 2026-11-10), laid out like the old program:
// Product, Supplier, Customer, Cash Sale, Finance, Reports, Backup. Plain data, shared by the server (which drops what a
// role may not open) and the menu bar; icons are named here and drawn by the menu bar.

export type Access = { resource: string; action: "read" | "write" };

export interface ClassicItem {
  id: string;
  label: string;
  /** A page, or a picker that asks for the customer or supplier first and then opens their ledger */
  href?: string;
  picker?: "customers" | "suppliers";
  icon: string;
  /** Keyboard shortcut (an id in SHORTCUT_ACTIONS); the user's own key is shown next to the item */
  shortcut?: string;
  /** Shown in the quick-launch strip on the left */
  quick?: string;
  access: Access;
  /** Starts a new group (a line above it) */
  group?: boolean;
}

export interface ClassicMenu {
  id: string;
  label: string;
  icon: string;
  /** Tailwind colour classes for the tab's icon tile */
  tone: string;
  items: ClassicItem[];
}

const read = (resource: string): Access => ({ resource, action: "read" });
const write = (resource: string): Access => ({ resource, action: "write" });

export const CLASSIC_MENUS: ClassicMenu[] = [
  {
    id: "product", label: "Product", icon: "Package", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    items: [
      { id: "item-groups", label: "Item Group", href: "/dashboard/inventory/groups", icon: "Boxes", access: read("inventory") },
      { id: "add-product", label: "Add New Product", href: "/dashboard/inventory/product?new=1", icon: "PackagePlus", access: write("inventory") },
      { id: "opening-stock", label: "Opening stock", href: "/dashboard/inventory/opening-stock", icon: "PackageOpen", access: write("inventory") },
      { id: "stock-count", label: "Stock count", href: "/dashboard/accounting/new/STOCK_ADJUSTMENT", icon: "ClipboardCheck", access: write("stockIssues") },
      { id: "products", label: "Products list", href: "/dashboard/inventory", icon: "List", shortcut: "inventory", access: read("inventory"), group: true },
      { id: "stock-position", label: "Stock and Sale Reports", href: "/dashboard/accounting/reports?report=stock", icon: "Warehouse", shortcut: "stock", access: read("inventory") },
      { id: "sale-reports", label: "Sales reports", href: "/dashboard/reports", icon: "ChartColumn", access: read("reports") },
    ],
  },
  {
    id: "supplier", label: "Supplier", icon: "Truck", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    items: [
      { id: "add-supplier", label: "Add New Supplier", href: "/dashboard/suppliers?new=1", icon: "UserPlus", access: write("suppliers") },
      { id: "stock-invoice", label: "Stock invoice", href: "/dashboard/purchases/new", icon: "FilePlus2", shortcut: "new-purchase", quick: "Stock invoice", access: write("purchases") },
      { id: "cash-paid", label: "Cash Paid", href: "/dashboard/purchases/pay", icon: "HandCoins", shortcut: "pay-supplier", quick: "Cash paid", access: write("supplierPayments") },
      { id: "supplier-ledger", label: "Supplier Ledger", picker: "suppliers", icon: "BookOpen", access: read("suppliers") },
      { id: "suppliers", label: "Suppliers list", href: "/dashboard/suppliers", icon: "Truck", shortcut: "suppliers", access: read("suppliers"), group: true },
      { id: "purchase-bills", label: "Purchase bills", href: "/dashboard/purchases", icon: "Receipt", shortcut: "purchases", access: read("purchases") },
      { id: "payables", label: "Payables (you owe)", href: "/dashboard/purchases/payables", icon: "Scale", shortcut: "payables", access: read("supplierPayments") },
    ],
  },
  {
    id: "customer", label: "Customer", icon: "Contact", tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    items: [
      { id: "add-customer", label: "Add New Customer", href: "/dashboard/customers?new=1", icon: "UserPlus", access: write("customers") },
      { id: "customer-invoice", label: "Customer invoice", href: "/dashboard/sales/new", icon: "FileText", shortcut: "new-sale", quick: "Customer invoice", access: write("sales") },
      { id: "cash-received", label: "Cash Received", href: "/dashboard/sales/payments", icon: "Wallet", shortcut: "receive-payment", quick: "Cash received", access: write("customerPayments") },
      { id: "customer-ledger", label: "Customer Ledger", picker: "customers", icon: "BookOpen", access: read("customers") },
      { id: "day-book", label: "Day Book", href: "/dashboard/accounting/reports?report=daybook", icon: "CalendarDays", shortcut: "daybook", quick: "Day book", access: read("ledgers") },
      { id: "customers", label: "Customers list", href: "/dashboard/customers", icon: "Users", shortcut: "customers", access: read("customers"), group: true },
      { id: "sales-bills", label: "Sales bills", href: "/dashboard/sales", icon: "Receipt", shortcut: "sales", access: read("sales") },
      { id: "outstanding", label: "Outstanding (customers owe)", href: "/dashboard/sales/receivables", icon: "Scale", shortcut: "receivables", access: read("customers") },
    ],
  },
  {
    id: "cash-sale", label: "Cash Sale", icon: "Banknote", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    items: [
      { id: "cash-sale", label: "Cash Sale (walk-in)", href: "/dashboard/sales/new?walkin=1", icon: "Banknote", quick: "Cash sale", access: write("sales") },
    ],
  },
  {
    id: "finance", label: "Finance", icon: "Calculator", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    items: [
      { id: "account-add", label: "Account Add", href: "/dashboard/accounting/settings#add-account", icon: "UserPlus", access: write("accountingSettings") },
      { id: "receipt-voucher", label: "Receipt Voucher", href: "/dashboard/accounting/new/VOUCHER?series=CRV", icon: "ArrowDownToLine", access: write("vouchers") },
      { id: "paid-voucher", label: "Paid Voucher", href: "/dashboard/accounting/new/VOUCHER?series=CPV", icon: "ArrowUpFromLine", access: write("vouchers") },
      { id: "journal-voucher", label: "Journal Voucher", href: "/dashboard/accounting/new/VOUCHER?series=JV", icon: "Repeat", access: write("vouchers") },
      { id: "ledger", label: "Ledger", href: "/dashboard/accounting/ledger", icon: "BookOpen", shortcut: "ledger", quick: "Ledger", access: read("ledgers") },
      { id: "cash-book", label: "Cash / bank book", href: "/dashboard/accounting/reports?report=cash-book", icon: "Landmark", shortcut: "cash-book", access: read("ledgers"), group: true },
      { id: "transfer", label: "Transfer (cash / bank)", href: "/dashboard/accounting/new/TRANSFER", icon: "ArrowLeftRight", access: write("transfers") },
      { id: "books", label: "Books home", href: "/dashboard/accounting", icon: "Library", shortcut: "books", access: read("ledgers") },
    ],
  },
  {
    id: "reports", label: "Reports", icon: "ChartColumn", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    items: [
      { id: "profit-loss", label: "Profit & Loss", href: "/dashboard/accounting/reports?report=profit-loss", icon: "TrendingUp", shortcut: "profit-loss", access: read("ledgers") },
      { id: "balance-sheet", label: "Balance Sheet", href: "/dashboard/accounting/reports?report=balance-sheet", icon: "Scale", access: read("ledgers") },
      { id: "trial-balance", label: "Trial balance", href: "/dashboard/accounting/reports?report=trial-balance", icon: "Sigma", access: read("ledgers") },
      { id: "party-balances", label: "Party balances", href: "/dashboard/accounting/reports?report=party-balances", icon: "Users", shortcut: "party-balances", access: read("ledgers") },
      { id: "profit", label: "Profit by customer and product", href: "/dashboard/accounting/reports?report=profit", icon: "ChartColumn", access: read("reports"), group: true },
      { id: "kg-report", label: "Kg bought / sold", href: "/dashboard/accounting/reports?report=kg", icon: "Weight", access: read("reports") },
    ],
  },
  {
    id: "backup", label: "Backup", icon: "HardDrive", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    items: [
      { id: "backups", label: "Backups", href: "/dashboard/accounting/backups", icon: "HardDrive", shortcut: "backups", access: read("backupLocal") },
    ],
  },
];

/** The menus a role may use: items it cannot open are left out, and so is a menu left empty. */
export function visibleMenus(allowed: (a: Access) => boolean, menus: ClassicMenu[] = CLASSIC_MENUS): ClassicMenu[] {
  return menus
    .map((m) => ({ ...m, items: m.items.filter((i) => allowed(i.access)) }))
    .filter((m) => m.items.length > 0);
}

/**
 * The menu a page belongs to, to mark its tab. The longest matching address wins; an item whose address has a query
 * (e.g. `?report=daybook`) matches only when the page has the same values, and then beats one without.
 */
export function menuForPath(menus: ClassicMenu[], pathname: string, search = ""): string | null {
  const current = new URLSearchParams(search);
  let best: { id: string; score: number } | null = null;
  for (const m of menus) for (const i of m.items) {
    if (!i.href) continue;
    const [path, query = ""] = i.href.split("#")[0].split("?");
    if (path === "/dashboard" || !(pathname === path || pathname.startsWith(path + "/"))) continue;
    const wanted = [...new URLSearchParams(query)].filter(([k]) => k !== "new");
    if (wanted.some(([k, v]) => current.get(k) !== v)) continue;
    const score = path.length + (wanted.length ? 1000 : 0);
    if (!best || score > best.score) best = { id: m.id, score };
  }
  return best?.id ?? null;
}
