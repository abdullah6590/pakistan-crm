// src/components/layout/sidebar.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SIDEBAR_NAV, type NavItem } from "@/lib/constants";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Cpu,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SidebarProps {
  userRole: string;
  userName: string;
  userEmail: string;
}

export function Sidebar({ userRole, userName, userEmail }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const pathname = usePathname();

  const filteredNav = SIDEBAR_NAV.filter((item) =>
    item.roles.includes(userRole)
  );

  const toggleExpand = (title: string) => {
    const next = new Set(expandedItems);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    setExpandedItems(next);
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const NavLink = ({ item, depth = 0 }: { item: NavItem; depth?: number }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.title);
    const active = isActive(item.href);

    return (
      <div key={item.href + item.title}>
        {hasChildren ? (
          <button
            onClick={() => toggleExpand(item.title)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
              "hover:bg-accent hover:text-accent-foreground",
              active && "bg-primary/10 text-primary font-medium",
              collapsed && "justify-center px-2"
            )}
            style={{ paddingLeft: collapsed ? undefined : `${12 + depth * 16}px` }}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{item.title}</span>
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </>
            )}
          </button>
        ) : (
          <Link
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
              "hover:bg-accent hover:text-accent-foreground",
              active && "bg-primary/10 text-primary font-medium",
              collapsed && "justify-center px-2"
            )}
            style={{ paddingLeft: collapsed ? undefined : `${12 + depth * 16}px` }}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </Link>
        )}

        {hasChildren && isExpanded && !collapsed && (
          <div className="mt-0.5">
            {item.children!.map((child) => (
              <NavLink key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 rounded-lg border bg-background p-2 shadow-sm lg:hidden"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-card transition-all duration-300",
          collapsed ? "w-[68px]" : "w-[260px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className={cn("flex h-16 items-center border-b px-4", collapsed && "justify-center px-2")}>
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Cpu className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div>
                <p className="text-sm font-bold leading-tight">PM-ERP</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Paper Mill System</p>
              </div>
            )}
          </Link>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="flex flex-col gap-0.5">
            {filteredNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </nav>
        </ScrollArea>

        {/* User + Collapse */}
        <div className="border-t p-3">
          {!collapsed && (
            <div className="mb-3 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium truncate">{userName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
              <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {userRole}
              </span>
            </div>
          )}
          <div className={cn("flex gap-1", collapsed && "flex-col")}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(!collapsed)}
              className="h-8 w-8"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
            </Button>
            <form action="/api/auth/logout" method="POST">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Logout">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}