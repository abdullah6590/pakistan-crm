// src/app/dashboard/accounting/page.tsx - Accounting core hub: document entry, lists, ledgers and reports by permission.
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ClipboardCheck, FileText, HardDrive, Plus, Receipt, RefreshCw, Scale, Settings, Warehouse, Printer } from "lucide-react";
import { nodeRole } from "@/lib/tenancy/config";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { DOCUMENT_TYPES } from "@/lib/accounting/meta";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function AccountingHubPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const types = Object.entries(DOCUMENT_TYPES).filter(([type]) => can(user.role, DOCUMENT_RESOURCE[type], "read"));
  const reports = [
    { href: "/dashboard/accounting/ledger", title: "Account statement", icon: BookOpen, ok: can(user.role, "ledgers", "read") },
    { href: "/dashboard/accounting/reports?report=trial-balance", title: "Trial balance", icon: Scale, ok: can(user.role, "ledgers", "read") },
    { href: "/dashboard/accounting/reports?report=stock", title: "Stock position", icon: Warehouse, ok: can(user.role, "inventory", "read") },
    { href: "/dashboard/accounting/reports?report=press", title: "Press reconciliation", icon: Printer, ok: can(user.role, "press", "read") },
    { href: "/dashboard/accounting/reports?report=daybook", title: "Daybook", icon: BookOpen, ok: can(user.role, "ledgers", "read") },
    { href: "/dashboard/accounting/reports?report=profit", title: "Profit", icon: Scale, ok: can(user.role, "reports", "read") },
    { href: "/dashboard/accounting/backups", title: "Backups", icon: HardDrive, ok: can(user.role, "backupLocal", "read") },
    { href: "/dashboard/accounting/sync", title: "Sync", icon: RefreshCw, ok: nodeRole() !== "cloud" && can(user.role, "sync", "read") },
    { href: "/dashboard/accounting/charges", title: "Charges (freight, bilty, printing)", icon: Receipt, ok: can(user.role, "charges", "read") },
    { href: "/dashboard/accounting/reports?report=approvals", title: "Waiting for approval", icon: ClipboardCheck, ok: can(user.role, "stockApproval", "read") },
    { href: "/dashboard/accounting/settings", title: "Accounts, units and policies", icon: Settings, ok: can(user.role, "accountingSettings", "read") || can(user.role, "ledgers", "write") },
  ].filter((r) => r.ok);
  if (!types.length && !reports.length) redirect("/dashboard");

  const pending = can(user.role, "stockApproval", "read") ? await prisma.accountingDocument.count({ where: { status: "PENDING_APPROVAL" } }) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Books" description="Double-entry documents, stock movements, ledgers and reports" icon={BookOpen} />

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        This is the new accounting core. It runs separately from the older Sales, Purchases and Cash Sales screens and
        holds no imported U2024 history yet. Use it with test data until acceptance is signed off.
      </div>

      {reports.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <Link key={r.href} href={r.href}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center gap-3 p-4">
                  <r.icon className="h-5 w-5 text-primary" />
                  <span className="font-medium">{r.title}</span>
                  {r.title === "Waiting for approval" && pending > 0 && <Badge variant="destructive" className="ml-auto">{pending}</Badge>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {types.map(([type, meta]) => (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{meta.plural}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{meta.description}</p>
              <div className="flex gap-2">
                {can(user.role, DOCUMENT_RESOURCE[type], "write") && type !== "CHARGE_EXPENSE" && (
                  <Link className={buttonVariants({ size: "sm" })} href={`/dashboard/accounting/new/${type}`}><Plus className="mr-1 h-4 w-4" />New</Link>
                )}
                <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/dashboard/accounting/documents?type=${type}`}><FileText className="mr-1 h-4 w-4" />List</Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
