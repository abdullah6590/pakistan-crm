"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearLegacyDriveCredentials } from "@/lib/legacy-drive-cleanup";

export default function LegacyDriveRedirect() {
  const router = useRouter();
  useEffect(() => {
    clearLegacyDriveCredentials(window.localStorage);
    router.replace("/dashboard/accounting/backups");
  }, [router]);
  return <p className="p-6 text-sm text-muted-foreground">Moving to secure backups…</p>;
}
