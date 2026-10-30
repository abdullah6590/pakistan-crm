// src/app/dashboard/backup/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LegacyDriveRedirect from "./legacy-drive-redirect";

export default async function BackupPage() {
  const user = await getAuthUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  return <LegacyDriveRedirect />;
}
