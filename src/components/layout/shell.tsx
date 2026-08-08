// src/components/layout/shell.tsx
"use client";

import { Toaster } from "sonner";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

interface ShellProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
  };
  unreadNotifications?: number;
}

export function Shell({ children, user, unreadNotifications = 0 }: ShellProps) {
  return (
    <>
      <div className="flex min-h-screen bg-background">
        <Sidebar
          userRole={user.role}
          userName={user.name}
          userEmail={user.email}
        />
        <div className="flex flex-1 flex-col lg:pl-[260px] transition-all duration-300">
          <Header
            userName={user.name}
            userEmail={user.email}
            userRole={user.role}
            unreadNotifications={unreadNotifications}
          />
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            {children}
          </main>
          <footer className="border-t py-3 px-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} Paper Mill ERP. All rights reserved.</p>
              <p>Made in Pakistan 🇵🇰</p>
            </div>
          </footer>
        </div>
      </div>
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          style: { borderRadius: "12px", padding: "12px 16px" },
        }}
      />
    </>
  );
}