// src/components/layout/classic-shell.tsx - The Classic interface: title bar, the old program's menu bar, a quick-launch
// strip on the left and the page at full width (no sidebar).
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { Cpu } from "lucide-react";
import type { ClassicMenu } from "@/lib/classic-menu";
import { Header } from "./header";
import { ClassicMenuBar, QuickStrip } from "./classic-menu-bar";

interface Props {
  children: React.ReactNode;
  user: { name: string; email: string; role: string };
  unreadNotifications: number;
  menus: ClassicMenu[];
}

const Brand = () => (
  <Link href="/dashboard" className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Dashboard">
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden><Cpu className="h-4 w-4" /></span>
    <span className="hidden leading-tight sm:block">
      <span className="block text-sm font-bold">PM-ERP</span>
      <span className="block text-xs text-muted-foreground">Paper Mill System</span>
    </span>
  </Link>
);

export function ClassicShell({ children, user, unreadNotifications, menus }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-background" data-interface="classic">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to the page
      </a>
      <div className="sticky top-0 z-30 print:hidden">
        <Header userName={user.name} userEmail={user.email} userRole={user.role} unreadNotifications={unreadNotifications} layout="classic" brand={<Brand />} />
        <Suspense fallback={<div className="h-[69px] border-b bg-card/80" aria-hidden />}>
          <ClassicMenuBar menus={menus} />
        </Suspense>
      </div>
      <div className="flex flex-1">
        <Suspense fallback={null}>
          <QuickStrip menus={menus} />
        </Suspense>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6 lg:p-8 print:p-0">
          {children}
        </main>
      </div>
      <footer className="border-t px-6 py-3 print:hidden">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Paper Mill ERP. All rights reserved.</p>
          <p>Made in Pakistan</p>
        </div>
      </footer>
    </div>
  );
}
