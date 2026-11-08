// src/app/dashboard/settings/shortcuts/page.tsx - Settings -> Keyboard shortcuts (each user's own keys).
import { redirect } from "next/navigation";
import { Keyboard } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/shared/page-header";
import { defaultShortcuts, mergeShortcuts } from "@/lib/shortcuts";
import ShortcutsClient from "./shortcuts-client";

export const dynamic = "force-dynamic";

export default async function ShortcutsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const row = await prisma.setting.findUnique({ where: { key: `shortcuts:${user.id}` } });
  let saved: unknown = null;
  try { saved = row ? JSON.parse(row.value) : null; } catch { /* unreadable: the defaults apply */ }
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Keyboard shortcuts" description="Open the main sections with a key combination. These are your own keys; other users keep theirs." icon={Keyboard} />
      <ShortcutsClient initial={mergeShortcuts(saved)} defaults={defaultShortcuts()} />
    </div>
  );
}
