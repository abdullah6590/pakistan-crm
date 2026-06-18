// src/app/(dashboard)/dashboard-client.tsx
"use client";

import {
  Package,
  AlertTriangle,
  FolderKanban,
  Users,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  BadgeCheck,
  HandCoins,
  Wrench,
  Cpu,
  Building,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { formatCurrency, formatDate, timeAgo, getStatusColor, CHART_COLORS, MONTH_NAMES } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────
interface DashboardData {
  counts: {
    components: number;
    lowStock: number;
    projects: number;
    activeProjects: number;
    customers: number;
    suppliers: number;
    partners: number;
  };
  finance: {
    monthIncome: number;
    monthExpense: number;
    monthProfit: number;
  };
  sales: {
    monthTotal: number;
    monthProfit: number;
  };
  monthlyData: { month: string; income: number; expense: number }[];
  recentSales: any[];
  recentProjects: any[];
  topComponents: any[];
}

interface DashboardClientProps {
  data: DashboardData;
  user: { name: string; email: string; role: string };
}

// ─── Stat Card ──────────────────────────────────────────────
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = "default",
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  color?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const colorClasses = {
    default: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
    info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${colorClasses[color]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            {trend === "up" ? (
              <ArrowUpRight className="h-3 w-3 text-emerald-500" />
            ) : trend === "down" ? (
              <ArrowDownRight className="h-3 w-3 text-red-500" />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Status Badge Map ───────────────────────────────────────
const projectStatusMap: Record<string, BadgeVariant> = {
  PLANNING: "secondary",
  IN_PROGRESS: "default",
  COMPLETED: "success",
  ON_HOLD: "warning",
  CANCELLED: "destructive",
};

const paymentStatusMap: Record<string, BadgeVariant> = {
  PAID: "success",
  PARTIAL: "warning",
  PENDING: "secondary",
  OVERDUE: "destructive",
};

// ─── Main Dashboard ─────────────────────────────────────────
export default function DashboardClient({ data, user }: DashboardClientProps) {
  const { counts, finance, sales, monthlyData, recentSales, recentProjects, topComponents } = data;

  // Project status distribution
  const projectDistribution = [
    { name: "Active", value: counts.activeProjects, color: CHART_COLORS[0] },
    { name: "Completed", value: counts.projects - counts.activeProjects, color: CHART_COLORS[1] },
  ];

  // Inventory stats
  const inventoryHealthy = counts.components - counts.lowStock;
  const inventoryPie = [
    { name: "Healthy", value: Math.max(0, inventoryHealthy), color: CHART_COLORS[2] },
    { name: "Low Stock", value: counts.lowStock, color: CHART_COLORS[3] },
  ];

  return (
    <div className="space-y-6">
      {/* ─── Welcome Header ────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user.name?.split(" ")[0] || "User"} 👋
        </h1>
        <p className="text-muted-foreground">
          Here's what's happening with your electronics business today.
        </p>
      </div>

      {/* ─── Stats Grid ────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Monthly Revenue"
          value={formatCurrency(finance.monthIncome)}
          subtitle={`${sales.monthTotal > 0 ? "+" : ""}${formatCurrency(sales.monthTotal)} from sales`}
          icon={DollarSign}
          trend={finance.monthProfit > 0 ? "up" : "down"}
          color="success"
        />
        <StatCard
          title="Monthly Expenses"
          value={formatCurrency(finance.monthExpense)}
          subtitle="All outgoing payments"
          icon={Receipt}
          color="danger"
        />
        <StatCard
          title="Monthly Profit"
          value={formatCurrency(finance.monthProfit)}
          subtitle={finance.monthIncome > 0
            ? `${Math.round((finance.monthProfit / finance.monthIncome) * 100)}% margin`
            : "No income yet"}
          icon={TrendingUp}
          trend={finance.monthProfit > 0 ? "up" : "down"}
          color="info"
        />
        <StatCard
          title="Active Projects"
          value={String(counts.activeProjects)}
          subtitle={`${counts.projects} total projects`}
          icon={FolderKanban}
          color="default"
        />
      </div>

      {/* ─── Second Stats Row ──────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Inventory Items"
          value={String(counts.components)}
          subtitle={`${counts.lowStock} items low in stock`}
          icon={Package}
          color={counts.lowStock > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Customers"
          value={String(counts.customers)}
          icon={Users}
          color="info"
        />
        <StatCard
          title="Suppliers"
          value={String(counts.suppliers)}
          icon={Building}
          color="default"
        />
        <StatCard
          title="Partners"
          value={String(counts.partners)}
          icon={HandCoins}
          color="success"
        />
      </div>

      {/* ─── Charts Row ────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue vs Expense Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue vs Expenses</CardTitle>
            <CardDescription>Last 6 months overview</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[3]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[3]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), ""]}
                    contentStyle={{
                      borderRadius: "12px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="income"
                    stroke={CHART_COLORS[0]}
                    fill="url(#incomeGradient)"
                    strokeWidth={2}
                    name="Revenue"
                  />
                  <Area
                    type="monotone"
                    dataKey="expense"
                    stroke={CHART_COLORS[3]}
                    fill="url(#expenseGradient)"
                    strokeWidth={2}
                    name="Expenses"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Inventory & Project Overview */}
        <Card>
          <CardHeader>
            <CardTitle>Overview Distribution</CardTitle>
            <CardDescription>Inventory health & project status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Inventory Health</p>
                <div className="h-[130px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={inventoryPie}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        dataKey="value"
                      >
                        {inventoryPie.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [value, name]}
                        contentStyle={{ borderRadius: "12px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-4 text-xs mt-1">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[2] }} /> Healthy
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[3] }} /> Low Stock
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Project Status</p>
                <div className="h-[130px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={projectDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        dataKey="value"
                      >
                        {projectDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-4 text-xs mt-1">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[0] }} /> Active
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[1] }} /> Done
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Top Components ────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-muted-foreground" />
              Top Selling Components
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topComponents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No sales data yet. Start selling components to see insights.
              </p>
            ) : (
              <div className="space-y-3">
                {topComponents.map((comp, i) => (
                  <div key={comp.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{comp.name}</p>
                        <p className="text-xs text-muted-foreground">SKU: {comp.sku}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{comp.totalSold} sold</p>
                      <p className="text-xs text-muted-foreground">{comp.quantity} in stock</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Sales */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-muted-foreground" />
              Recent Sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentSales.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No sales recorded yet. Your recent transactions will appear here.
              </p>
            ) : (
              <div className="space-y-4">
                {recentSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <ShoppingCart className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {sale.customer?.name || sale.walkInName || "Walk-in Customer"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sale.invoiceNumber} · {timeAgo(sale.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(sale.total)}</p>
                      <Badge variant={paymentStatusMap[sale.paymentStatus] || "secondary"} size="sm">
                        {sale.paymentMethod}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Recent Projects ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            Recent Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No projects created yet. Start managing your electronics projects here.
            </p>
          ) : (
            <div className="space-y-4">
              {recentProjects.map((project) => (
                <div key={project.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `var(--primary-500, #3B82F6)15` }}
                    >
                      <FolderKanban className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {project.projectId} · {project.deadline ? `Due: ${formatDate(project.deadline)}` : "No deadline"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(project.clientPayment)}</p>
                      <p className={`text-xs ${project.profit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {project.profit >= 0 ? "+" : ""}{formatCurrency(project.profit)} profit
                      </p>
                    </div>
                    <Badge variant={projectStatusMap[project.status] || "secondary"} size="sm">
                      {project.status.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}