// src/lib/notifications.ts - Notification system
import prisma from './prisma';
import type { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(params: CreateNotificationParams) {
  try {
    return await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        link: params.link || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
    return null;
  }
}

// ─── Bulk Notifications (for all admins) ────────────────────────────
export async function notifyAdmins(
  type: NotificationType,
  title: string,
  message: string,
  link?: string
) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });

    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type,
        title,
        message,
        link: link || null,
      })),
    });
  } catch (error) {
    console.error('Failed to notify admins:', error);
  }
}

// ─── Automatic Stock Check ──────────────────────────────────────────
export async function checkLowStock(componentId: string) {
  try {
    const component = await prisma.component.findUnique({
      where: { id: componentId },
    });

    if (component && component.quantity <= component.minQuantity) {
      await notifyAdmins(
        'LOW_STOCK',
        `Low Stock Alert: ${component.name}`,
        `"${component.name}" (SKU: ${component.sku}) has only ${component.quantity} units remaining. Minimum threshold: ${component.minQuantity}. Please reorder soon.`,
        '/dashboard/inventory'
      );
    }
  } catch (error) {
    console.error('Stock check failed:', error);
  }
}

// ─── Project Deadline Reminder ──────────────────────────────────────
export async function checkProjectDeadlines() {
  try {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const pendingProjects = await prisma.project.findMany({
      where: {
        deadline: { lte: threeDaysFromNow },
        status: { in: ['PLANNING', 'IN_PROGRESS'] },
      },
      include: { user: { select: { id: true, name: true } } },
    });

    for (const project of pendingProjects) {
      await createNotification({
        userId: project.userId,
        type: 'PROJECT_DEADLINE',
        title: `Deadline Approaching: ${project.name}`,
        message: `Project "${project.name}" deadline is ${project.deadline?.toLocaleDateString()}. Status: ${project.status}`,
        link: `/dashboard/projects/${project.id}`,
      });
    }
  } catch (error) {
    console.error('Deadline check failed:', error);
  }
}

// ─── Get Unread Count ───────────────────────────────────────────────
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({
      where: { userId, isRead: false },
    });
  } catch {
    return 0;
  }
}

// ─── Mark As Read ──────────────────────────────────────────────────
export async function markAsRead(notificationId: string) {
  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}