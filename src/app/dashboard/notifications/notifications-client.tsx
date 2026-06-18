"use client";

import { useState } from "react";
import { Bell, CheckCircle2, CheckCheck, AlertTriangle, Clock, Package, Truck, CreditCard, Info, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

interface NotificationItem {
  id: string; type: string; title: string; message: string;
  reference: string | null; isRead: boolean;
  createdAt: string;
}

interface Props { notifications: NotificationItem[]; unreadCount: number; }

const typeConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  LOW_STOCK: { icon: Package, color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/30" },
  PENDING_PAYMENT: { icon: CreditCard, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
  PROJECT_DEADLINE: { icon: Calendar, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
  SUPPLIER_DUE: { icon: Truck, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
  OVERDUE_INVOICE: { icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100 dark:bg-rose-900/30" },
  SYSTEM: { icon: Info, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-900/30" },
};

export default function NotificationsClient({ notifications: initialNotifications, unreadCount: initialUnread }: Props) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [markingAll, setMarkingAll] = useState(false);

  const markAsRead = async (id: string) => {
    try {
      const res = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch { toast.error("Failed to mark as read"); }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        setUnreadCount(0);
        toast.success("All notifications marked as read");
      }
    } catch { toast.error("Failed to mark all as read"); }
    finally { setMarkingAll(false); }
  };

  const unreadNotifications = notifications.filter(n => !n.isRead);
  const readNotifications = notifications.filter(n => n.isRead);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
        icon={Bell}
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" onClick={markAllRead} disabled={markingAll}>
              <CheckCheck className="h-4 w-4 mr-1" /> Mark All Read
            </Button>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="p-12">
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You're all caught up! Notifications about low stock, payments, and deadlines will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Unread Notifications */}
          {unreadNotifications.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" /> Unread ({unreadNotifications.length})
              </h2>
              <div className="space-y-2">
                {unreadNotifications.map(n => {
                  const config = typeConfig[n.type] || typeConfig.SYSTEM;
                  const Icon = config.icon;
                  return (
                    <Card
                      key={n.id}
                      className="cursor-pointer border-l-4 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10 hover:bg-muted/50 transition-colors"
                      onClick={() => markAsRead(n.id)}
                    >
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className={`rounded-full p-2 ${config.bg} ${config.color} mt-0.5`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm">{n.title}</p>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}>
                              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                          <p className="text-xs text-muted-foreground mt-1.5">{timeAgo(n.createdAt)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Read Notifications */}
          {readNotifications.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <CheckCheck className="h-4 w-4" /> Read ({readNotifications.length})
              </h2>
              <div className="space-y-2">
                {readNotifications.map(n => {
                  const config = typeConfig[n.type] || typeConfig.SYSTEM;
                  const Icon = config.icon;
                  return (
                    <Card key={n.id} className="opacity-70">
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className={`rounded-full p-2 ${config.bg} ${config.color} mt-0.5`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{n.title}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                          <p className="text-xs text-muted-foreground mt-1.5">{formatDate(n.createdAt)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}