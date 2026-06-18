// src/app/(dashboard)/notifications/page.tsx - Notifications (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUnreadCount } from "@/lib/notifications";
import NotificationsClient from "./notifications-client";

export default async function NotificationsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const notifications = await prisma.notification.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unreadCount = await getUnreadCount(user.userId);

  return (
    <NotificationsClient
      notifications={JSON.parse(JSON.stringify(notifications))}
      unreadCount={unreadCount}
    />
  );
}