// src/app/api/notifications/route.ts - Notifications API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { getUnreadCount, markAsRead, markAllAsRead } from "@/lib/notifications";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await getUnreadCount(user.userId);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  if (body.markAllRead) {
    await markAllAsRead(user.userId);
    return NextResponse.json({ success: true });
  }

  if (body.id) {
    await markAsRead(body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}