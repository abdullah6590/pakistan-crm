// src/app/(dashboard)/layout.tsx
import { getAuthUser } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications";
import { Shell } from "@/components/layout/shell";
import VoiceAssistant from "@/components/ai/voice-assistant";
import ShortcutKeys from "@/components/layout/shortcut-keys";
import GlobalSearch from "@/components/layout/global-search";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { visibleMenus } from "@/lib/classic-menu";
import { interfaceKey, parseLayout } from "@/lib/interface-pref";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  const [unreadCount, pref] = await Promise.all([
    getUnreadCount(user.id),
    prisma.setting.findUnique({ where: { key: interfaceKey(user.id) } }),
  ]);
  const layout = parseLayout(pref?.value);
  // The Classic menus hold only what this role may open (the pages check again)
  const menus = layout === "classic" ? visibleMenus((a) => can(user.role, a.resource, a.action)) : [];

  return (
    <Shell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
      }}
      unreadNotifications={unreadCount}
      layout={layout}
      menus={menus}
    >
      {children}
      <VoiceAssistant />
      <ShortcutKeys />
      <GlobalSearch />
    </Shell>
  );
}