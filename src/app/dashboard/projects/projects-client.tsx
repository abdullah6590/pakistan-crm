"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FolderKanban, Plus, Search, Filter, ArrowUpDown, Eye,
  Clock, BadgeCheck, AlertTriangle, Wrench, Ban, Calendar,
  DollarSign, Users, Cpu, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatsCards } from "@/components/shared/stats-cards";
import { formatCurrency, formatDate, daysUntil } from "@/lib/utils";
import { PROJECT_STATUSES } from "@/lib/constants";
import { toast } from "sonner";

interface ProjectItem {
  id: string; projectId: string; name: string; description: string | null;
  clientName: string | null; clientPhone: string | null; clientEmail: string | null;
  startDate: string; deadline: string | null; status: string;
  laborCost: number; otherCosts: number; clientPayment: number; totalCost: number;
  profit: number; paymentStatus: string; notes: string | null; color: string;
  userId: string; createdAt: string;
  user?: { name: string };
  teamMembers?: any[]; components?: any[];
  _count?: { teamMembers: number; components: number };
}

interface UserOption { id: string; name: string; email: string; role: string; }

const statusConfig: Record<string, { icon: React.ElementType; variant: "default"|"secondary"|"success"|"warning"|"destructive"; label: string }> = {
  PLANNING: { icon: Clock, variant: "secondary", label: "Planning" },
  IN_PROGRESS: { icon: Wrench, variant: "default", label: "In Progress" },
  COMPLETED: { icon: BadgeCheck, variant: "success", label: "Completed" },
  ON_HOLD: { icon: AlertTriangle, variant: "warning", label: "On Hold" },
  CANCELLED: { icon: Ban, variant: "destructive", label: "Cancelled" },
};

const paymentStatusConfig: Record<string, { variant: "default"|"secondary"|"success"|"warning"|"destructive"; label: string }> = {
  PAID: { variant: "success", label: "Paid" },
  PARTIAL: { variant: "warning", label: "Partial" },
  PENDING: { variant: "secondary", label: "Pending" },
};

export function ProjectsClient({ projects, users }: { projects: ProjectItem[]; users: UserOption[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = projects.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !p.projectId.toLowerCase().includes(search.toLowerCase()) &&
        !(p.clientName || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    return true;
  });

  const stats = [
    { label: "Total Projects", value: String(projects.length), icon: FolderKanban, color: "default" as const },
    { label: "Active", value: String(projects.filter(p => ["PLANNING","IN_PROGRESS"].includes(p.status)).length), icon: Wrench, color: "info" as const },
    { label: "Completed", value: String(projects.filter(p => p.status === "COMPLETED").length), icon: BadgeCheck, color: "success" as const },
    { label: "Total Revenue", value: formatCurrency(projects.reduce((s,p) => s + (p.clientPayment || 0), 0)), icon: DollarSign, color: "info" as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description="Manage your electronics and IoT projects"
        actions={
          <Link href="/dashboard/projects/new">
            <Button><Plus className="h-4 w-4 mr-2" /> New Project</Button>
          </Link>
        }
      />

      <StatsCards stats={stats} />

      {/* Filters */}
      <div className="flex gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." className="flex-1" />
        <Select value={statusFilter} onChange={(v) => setStatusFilter(v)}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Project Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((project) => {
          const status = statusConfig[project.status] || statusConfig.PLANNING;
          const pStatus = paymentStatusConfig[project.paymentStatus] || paymentStatusConfig.PENDING;
          const isOverdue = project.deadline && new Date(project.deadline) < new Date() && project.status !== "COMPLETED";
          const daysLeft = project.deadline ? daysUntil(project.deadline) : null;
          const profitColor = (project.profit || 0) >= 0 ? "text-emerald-600" : "text-red-600";

          return (
            <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full group">
                <CardContent className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <FolderKanban className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold group-hover:text-primary transition-colors line-clamp-1">
                          {project.name}
                        </h3>
                        <p className="text-[11px] text-muted-foreground font-mono">{project.projectId}</p>
                      </div>
                    </div>
                    <Badge variant={status.variant} size="sm">{status.label}</Badge>
                  </div>

                  {/* Client */}
                  {project.clientName && (
                    <p className="text-xs text-muted-foreground mb-2">Client: {project.clientName}</p>
                  )}

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <DollarSign className="h-3 w-3" />
                      <span>{formatCurrency(project.clientPayment || 0)}</span>
                    </div>
                    <div className={`flex items-center gap-1 font-medium ${profitColor}`}>
                      <span>{formatCurrency(project.profit || 0)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{project._count?.teamMembers || 0} members</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Cpu className="h-3 w-3" />
                      <span>{project._count?.components || 0} components</span>
                    </div>
                  </div>

                  {/* Deadline & Payment */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <div>
                      {project.deadline ? (
                        <span className={`text-xs flex items-center gap-1 ${isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          <Calendar className="h-3 w-3" />
                          {formatDate(project.deadline)}
                          {daysLeft !== null && (
                            <span className={daysLeft < 0 ? "text-red-600" : "text-muted-foreground"}>
                              ({daysLeft < 0 ? `${Math.abs(daysLeft)}d late` : `${daysLeft}d left`})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No deadline</span>
                      )}
                    </div>
                    <Badge variant={pStatus.variant} size="sm">{pStatus.label}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <FolderKanban className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No projects found</p>
          <p className="text-sm">Create your first project to get started.</p>
          <Link href="/dashboard/projects/new">
            <Button className="mt-4"><Plus className="h-4 w-4 mr-2" /> New Project</Button>
          </Link>
        </div>
      )}
    </div>
  );
}