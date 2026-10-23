// src/app/dashboard/accounting/settings/page.tsx - Accounting policies, chart of accounts and item units.
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { SETTING_DEFAULTS, SettingKey, getSetting } from "@/lib/accounting/setup";
import { accountingReady } from "@/lib/accounting/server";
import { unitConfigFor } from "@/lib/accounting/posting";
import { PageHeader } from "@/components/shared/page-header";
import SettingsClient from "./settings-client";

export default async function AccountingSettingsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const canReadSettings = can(user.role, "accountingSettings", "read");
  const canAccounts = can(user.role, "ledgers", "write");
  const canUnits = can(user.role, "inventory", "write");
  if (!canReadSettings && !canAccounts && !canUnits) redirect("/dashboard/accounting");
  await accountingReady();

  const settings: Record<string, string> = {};
  if (canReadSettings) for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) settings[key] = String(await getSetting(prisma, key));
  const accounts = await prisma.ledgerAccount.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] });
  const admins = canReadSettings ? await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }) : [];
  const items = canUnits
    ? (await prisma.component.findMany({ where: { isActive: true }, include: { unitProfile: { include: { conversions: true } } }, orderBy: { name: "asc" } })).map((c) => {
        const { cfg, confirmed } = unitConfigFor(c);
        return {
          id: c.id, sku: c.sku, name: c.name, cfg, confirmed, hasProfile: !!c.unitProfile,
          referencePurchasePrice: c.unitProfile?.referencePurchasePrice ?? "", referenceExpenses: c.unitProfile?.referenceExpenses ?? "",
        };
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Books settings" description="Policies, accounts, and the units each item is bought, stocked and sold in" icon={Settings} />
      <SettingsClient
        settings={settings}
        admins={admins.map((a) => ({ id: a.id, label: `${a.name} (${a.email})` }))}
        canEditSettings={can(user.role, "accountingSettings", "write")}
        canAccounts={canAccounts}
        canUnits={canUnits}
        accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, subType: a.subType, isSystem: a.isSystem }))}
        items={items}
      />
    </div>
  );
}
