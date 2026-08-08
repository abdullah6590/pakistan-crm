"use client";

import { useState } from "react";
import {
  BarChart3, TrendingUp, TrendingDown, Package, Truck,
  Users, DollarSign, FileText, Download, Loader2, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

const REPORT_TYPES = [
  { key: "profit-loss", label: "Profit & Loss", icon: TrendingUp, description: "Income vs expenses over a period" },
  { key: "sales", label: "Sales Report", icon: DollarSign, description: "Sales breakdown by period, customer, payment method" },
  { key: "inventory", label: "Inventory Report", icon: Package, description: "Stock levels, low stock alerts, valuations" },
  { key: "purchases", label: "Purchase Report", icon: Truck, description: "Purchase orders, supplier spend, pending payments" },
  { key: "customers", label: "Customer Report", icon: Users, description: "Top customers, purchase history, outstanding" },
] as const;

export default function ReportsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);

  const generateReport = async (type: string, format: "json" | "excel" | "pdf") => {
    setGenerating(format);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("format", format);

      let endpoint = "";
      switch (type) {
        case "profit-loss": endpoint = "/api/reports/profit-loss"; break;
        case "sales": endpoint = "/api/reports/sales"; break;
        case "inventory": endpoint = "/api/reports/inventory"; break;
        case "purchases": endpoint = "/api/reports/purchases"; break;
        case "projects": endpoint = "/api/reports/projects"; break;
        case "customers": endpoint = "/api/reports/customers"; break;
      }

      if (format === "excel" || format === "pdf") {
        // For file downloads, trigger download
        const res = await fetch(`${endpoint}?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to generate report");

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ext = format === "excel" ? "xlsx" : "pdf";
        const reportLabel = REPORT_TYPES.find(r => r.key === type)?.label || type;
        a.href = url;
        a.download = `${reportLabel.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`${reportLabel} downloaded`);
      } else {
        const res = await fetch(`${endpoint}?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to generate report");
        const data = await res.json();
        setReportData(data);
        toast.success("Report generated");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate report");
    } finally {
      setGenerating(null);
    }
  };

  const selectedReport = REPORT_TYPES.find(r => r.key === selected);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Generate business reports and export to PDF or Excel"
        icon={FileText}
      />

      {/* Report Type Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map(report => {
          const Icon = report.icon;
          const isSelected = selected === report.key;
          return (
            <Card
              key={report.key}
              className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary border-primary" : ""}`}
              onClick={() => { setSelected(report.key); setReportData(null); }}
            >
              <CardContent className="p-5 flex items-start gap-4">
                <div className={`rounded-full p-2.5 ${isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">{report.label}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{report.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Date Filters & Generate */}
      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {(() => {
                const Icon = selectedReport?.icon || FileText;
                return <Icon className="h-5 w-5" />;
              })()}
              {selectedReport?.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 space-y-1">
                <Label className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => generateReport(selected, "json")} disabled={!!generating} variant="outline">
                {generating === "json" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-1" />}
                Preview
              </Button>
              <Button onClick={() => generateReport(selected, "excel")} disabled={!!generating} variant="outline">
                {generating === "excel" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                Export Excel
              </Button>
              <Button onClick={() => generateReport(selected, "pdf")} disabled={!!generating} variant="outline">
                {generating === "pdf" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                Export PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Report Preview */}
      {reportData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Report Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {selected === "profit-loss" && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="rounded-full p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"><TrendingUp className="h-4 w-4" /></div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Income</p>
                        <p className="text-xl font-bold">{formatCurrency(reportData.totalIncome || 0)}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="rounded-full p-2 bg-red-100 dark:bg-red-900/30 text-red-600"><TrendingDown className="h-4 w-4" /></div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Expenses</p>
                        <p className="text-xl font-bold">{formatCurrency(reportData.totalExpense || 0)}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={`rounded-full p-2 ${(reportData.netProfit || 0) >= 0 ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600" : "bg-red-100 dark:bg-red-900/30 text-red-600"}`}><DollarSign className="h-4 w-4" /></div>
                      <div>
                        <p className="text-xs text-muted-foreground">Net Profit</p>
                        <p className="text-xl font-bold">{formatCurrency(reportData.netProfit || 0)}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {selected === "sales" && reportData.sales && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Sales</p>
                      <p className="text-xl font-bold">{reportData.sales.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Revenue</p>
                      <p className="text-xl font-bold">{formatCurrency(reportData.totalRevenue || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Profit</p>
                      <p className="text-xl font-bold text-emerald-600">{formatCurrency(reportData.totalProfit || 0)}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {selected === "inventory" && reportData.components && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Components</p>
                      <p className="text-xl font-bold">{reportData.components.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Stock Value</p>
                      <p className="text-xl font-bold">{formatCurrency(reportData.totalValue || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Low Stock Items</p>
                      <p className="text-xl font-bold text-orange-600">{reportData.lowStockCount || 0}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {selected === "purchases" && reportData.purchases && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total P.O.</p>
                      <p className="text-xl font-bold">{reportData.purchases.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Spent</p>
                      <p className="text-xl font-bold">{formatCurrency(reportData.totalSpent || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Pending Payments</p>
                      <p className="text-xl font-bold text-red-600">{formatCurrency(reportData.pendingPayments || 0)}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {selected === "projects" && reportData.projects && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Projects</p>
                      <p className="text-xl font-bold">{reportData.projects.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Revenue</p>
                      <p className="text-xl font-bold">{formatCurrency(reportData.totalRevenue || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Profit</p>
                      <p className="text-xl font-bold text-emerald-600">{formatCurrency(reportData.totalProfit || 0)}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {selected === "customers" && reportData.customers && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Customers</p>
                      <p className="text-xl font-bold">{reportData.customers.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Revenue</p>
                      <p className="text-xl font-bold">{formatCurrency(reportData.totalRevenue || 0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Avg per Customer</p>
                      <p className="text-xl font-bold">{formatCurrency(reportData.avgPerCustomer || 0)}</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {!reportData && (
              <p className="text-center text-muted-foreground py-8">Select a report type and click Preview to see data</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}