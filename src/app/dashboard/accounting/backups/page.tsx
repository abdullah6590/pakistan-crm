// src/app/dashboard/accounting/backups/page.tsx - Automatic encrypted backups of this computer's data (Report 22).
import { redirect } from "next/navigation";
import { HardDrive } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import BackupsClient from "./backups-client";
import RestoreClient from "./restore-client";
import { backupStatus, driveStatus, restoreSources } from "@/lib/backup/runtime";
import { nodeRole, tenancyMode } from "@/lib/tenancy/config";

export default async function BackupsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!can(user.role, "backupLocal", "read")) redirect("/dashboard/accounting");
  return (
    <div className="space-y-6">
      <PageHeader title="Backups" icon={HardDrive} description="Encrypted copies of this computer's data, including entries not yet synchronised. Only someone with the backup passphrase can restore them." />
      <BackupsClient status={await backupStatus()} drive={await driveStatus()} notice={await searchParams} />
      {tenancyMode() !== "multi" && <RestoreClient sources={await restoreSources()} role={nodeRole()} />}
    </div>
  );
}
