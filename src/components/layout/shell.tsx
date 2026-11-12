// src/components/layout/shell.tsx
"use client";

import { Toaster } from "sonner";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { ClassicShell } from "./classic-shell";
import type { ClassicMenu } from "@/lib/classic-menu";
import type { UiLayout } from "@/lib/interface-pref";

interface ShellProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
  };
  unreadNotifications?: number;
  /** The user's interface: the sidebar (modern) or the old program's menu bar (classic) */
  layout?: UiLayout;
  /** The Classic menus this user may open */
  menus?: ClassicMenu[];
}

const toaster = (
  <Toaster
    position="top-right"
    richColors
    closeButton
    toastOptions={{
      style: { borderRadius: "12px", padding: "12px 16px" },
    }}
  />
);

export function Shell({ children, user, unreadNotifications = 0, layout = "modern", menus = [] }: ShellProps) {
  if (layout === "classic") {
    return (
      <>
        <ClassicShell user={user} unreadNotifications={unreadNotifications} menus={menus}>{children}</ClassicShell>
        {toaster}
      </>
    );
  }
  return (
    <>
      <div className="flex min-h-screen bg-background" data-interface="modern">
        <Sidebar
          userRole={user.role}
          userName={user.name}
          userEmail={user.email}
        />
        <div className="flex min-w-0 flex-1 flex-col lg:pl-[260px] print:pl-0 transition-all duration-300">
          <Header
            userName={user.name}
            userEmail={user.email}
            userRole={user.role}
            unreadNotifications={unreadNotifications}
            layout="modern"
          />
          {/* min-w-0: a wide table (the sale grid) scrolls inside its own box instead of widening the whole page */}
          <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8 print:p-0">
            {children}
          </main>
          <footer className="border-t py-3 px-6 print:hidden">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} Paper Mill ERP. All rights reserved.</p>
              <p>Made in Pakistan 🇵🇰</p>
            </div>
          </footer>
        </div>
      </div>
      {toaster}
    </>
  );
}