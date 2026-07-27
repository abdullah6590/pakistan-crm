// src/app/(dashboard)/layout.tsx
import { getAuthUser } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications";
import { Shell } from "@/components/layout/shell";
import VoiceAssistant from "@/components/ai/voice-assistant";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  const unreadCount = await getUnreadCount(user.id);

  return (
    <Shell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
      }}
      unreadNotifications={unreadCount}
    >
      {children}
      <VoiceAssistant />
    </Shell>
  );
}