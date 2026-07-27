// src/app/dashboard/backup/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import BackupClient from "./backup-client";
import { prisma } from "@/lib/prisma";

export default async function BackupPage() {
  const user = await getAuthUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  // Get some quick stats for the dashboard display
  const stats = {
    users: await prisma.user.count(),
    customers: await prisma.customer.count(),
    suppliers: await prisma.supplier.count(),
    components: await prisma.component.count(),
    sales: await prisma.sale.count(),
    purchases: await prisma.purchase.count(),
  };

  return <BackupClient stats={stats} />;
}
