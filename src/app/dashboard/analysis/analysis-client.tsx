"use client";

import { useMemo } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { PageHeader } from "@/components/shared/page-header";
import { LineChart as ChartIcon, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

interface Props {
  moduleName: string;
  data: any[];
  params: { [key: string]: string };
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a855f7', '#ec4899', '#14b8a6'];

export default function AnalysisClient({ moduleName, data, params }: Props) {
  const router = useRouter();
  
  const { summary, chartData, pieData } = useMemo(() => {
    let summary: any = { totalRecords: data.length };
    let chartMap: Record<string, any> = {};
    let pieMap: Record<string, number> = {};

    switch (moduleName) {
      case "sales": {
        let totalVal = 0;
        let paidVal = 0;
        data.forEach(s => {
          totalVal += s.total;
          if (s.paymentStatus === "PAID") paidVal += s.total;
          
          const month = new Date(s.createdAt).toISOString().slice(0, 7); // YYYY-MM
          if (!chartMap[month]) chartMap[month] = { name: month, total: 0, paid: 0 };
          chartMap[month].total += s.total;
          if (s.paymentStatus === "PAID") chartMap[month].paid += s.total;

          const stat = s.paymentStatus;
          pieMap[stat] = (pieMap[stat] || 0) + s.total;
        });
        summary.totalRevenue = totalVal;
        summary.totalPaid = paidVal;
        break;
      }
      case "purchases": {
        let totalVal = 0;
        data.forEach(p => {
          totalVal += p.total;
          const month = new Date(p.createdAt).toISOString().slice(0, 7);
          if (!chartMap[month]) chartMap[month] = { name: month, total: 0 };
          chartMap[month].total += p.total;

          const stat = p.paymentStatus;
          pieMap[stat] = (pieMap[stat] || 0) + p.total;
        });
        summary.totalPurchases = totalVal;
        break;
      }
      case "inventory": {
        let totalVal = 0;
        let totalQty = 0;
        data.forEach(i => {
          totalVal += i.quantity * i.sellingPrice;
          totalQty += i.quantity;
          
          const cat = i.category?.name || "Uncategorized";
          pieMap[cat] = (pieMap[cat] || 0) + (i.quantity * i.sellingPrice);
        });
        summary.totalStockValue = totalVal;
        summary.totalItemsQuantity = totalQty;
        break;
      }
      case "finance": {
        let inc = 0;
        let exp = 0;
        data.forEach(f => {
          if (f.type === "INCOME") inc += f.amount;
          else exp += f.amount;

          const month = new Date(f.date).toISOString().slice(0, 7);
          if (!chartMap[month]) chartMap[month] = { name: month, income: 0, expense: 0 };
          if (f.type === "INCOME") chartMap[month].income += f.amount;
          else chartMap[month].expense += f.amount;
        });
        summary.totalIncome = inc;
        summary.totalExpense = exp;
        summary.net = inc - exp;
        
        pieMap["Income"] = inc;
        pieMap["Expense"] = exp;
        break;
      }
      case "expenditures": {
        let tot = 0;
        data.forEach(e => {
          tot += e.amount;
          const month = new Date(e.date).toISOString().slice(0, 7);
          if (!chartMap[month]) chartMap[month] = { name: month, amount: 0 };
          chartMap[month].amount += e.amount;
          
          pieMap[e.category] = (pieMap[e.category] || 0) + e.amount;
        });
        summary.totalExpenditure = tot;
        break;
      }
      default:
        break;
    }

    const sortedChartData = Object.values(chartMap).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const pieDataArr = Object.entries(pieMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    return { summary, chartData: sortedChartData, pieData: pieDataArr };
  }, [data, moduleName]);

  const handlePrint = () => {
    const p = new URLSearchParams(window.location.search);
    p.set("print", "true");
    window.open(`/dashboard/print?${p.toString()}`, "_blank");
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title={`${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} Analysis`} 
        description="Data insights based on your selected filters" 
        icon={ChartIcon} 
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>Back</Button>
            <Button onClick={handlePrint}><Printer className="h-4 w-4 mr-2" /> Print Data</Button>
          </div>
        }
      />

      {Object.keys(params).length > 1 && (
        <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-900">
          <CardContent className="p-4 flex flex-wrap gap-2 items-center">
            <span className="text-sm font-semibold text-blue-800 dark:text-blue-300 mr-2">Filters Applied:</span>
            {Object.entries(params).map(([k, v]) => k !== "module" && (
              <span key={k} className="text-xs bg-white dark:bg-slate-800 border px-2 py-1 rounded-md text-slate-700 dark:text-slate-300">
                <span className="font-medium capitalize">{k}:</span> {v}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(summary).map(([k, v]) => (
          <Card key={k}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                {k.replace(/([A-Z])/g, ' $1').trim()}
              </p>
              <p className="text-2xl font-bold mt-1">
                {typeof v === "number" && k.toLowerCase().includes("totalrecords") ? v : 
                 typeof v === "number" && k.toLowerCase().includes("quantity") ? v : 
                 typeof v === "number" ? formatCurrency(v) : (v as any)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        {chartData.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickMargin={10} />
                  <YAxis fontSize={12} tickFormatter={v => `Rs ${v/1000}k`} />
                  <RechartsTooltip formatter={(val: any) => formatCurrency(Number(val))} />
                  {Object.keys(chartData[0] || {}).filter(k => k !== 'name').map((key, i) => (
                    <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} name={key.charAt(0).toUpperCase() + key.slice(1)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Pie Chart */}
        {pieData.length > 0 && (
          <Card className={chartData.length === 0 ? "lg:col-span-3" : ""}>
            <CardHeader><CardTitle>Composition</CardTitle></CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                    {pieData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip formatter={(val: any) => formatCurrency(Number(val))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {pieData.slice(0, 6).map((entry, index) => (
                  <div key={index} className="flex items-center text-xs">
                    <span className="w-3 h-3 rounded-full mr-1" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                    <span className="truncate max-w-[100px]">{entry.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  );
}
