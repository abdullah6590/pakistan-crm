"use client";

import { useState, useEffect } from "react";
import { BookOpen, TrendingUp, TrendingDown, Users, Truck, Wallet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { formatCurrency, formatDate } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from "sonner";

interface Props {
  initialSection: "finance" | "supplier" | "customer";
  initialAccounts: any[];
}

export default function DaybookClient({ initialSection, initialAccounts }: Props) {
  const [section, setSection] = useState(initialSection);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ section });
      if (dateRange.start) params.append("startDate", dateRange.start);
      if (dateRange.end) params.append("endDate", dateRange.end);
      const res = await fetch(`/api/daybook?${params.toString()}`);
      const json = await res.json();
      setData(json);
    } catch {
      toast.error("Failed to load daybook data");
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [section, dateRange]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <PageHeader title="Master Daybook" description="Unified ledger for all financial, supplier, and customer activities" icon={BookOpen} />
        
        <div className="flex items-center gap-3">
          <Input type="date" value={dateRange.start} onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))} className="w-auto" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" value={dateRange.end} onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))} className="w-auto" />
          <Button variant="outline" onClick={handlePrint} className="print:hidden"><FileText className="h-4 w-4 mr-2" /> Print/PDF</Button>
        </div>
      </div>

      <Tabs value={section} onChange={(v: any) => setSection(v)} className="print:block">
        <TabsList className="grid w-full max-w-md grid-cols-3 print:hidden">
          <TabsTrigger value="finance"><Wallet className="h-4 w-4 mr-2" /> Finance</TabsTrigger>
          <TabsTrigger value="supplier"><Truck className="h-4 w-4 mr-2" /> Suppliers</TabsTrigger>
          <TabsTrigger value="customer"><Users className="h-4 w-4 mr-2" /> Customers</TabsTrigger>
        </TabsList>

        {loading && !data ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">Loading daybook...</div>
        ) : data && (
          <div className="mt-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {section === "finance" && (
                <>
                  <StatCard title="Net Profit/Loss" amount={data.summary.netProfit} type={data.summary.netProfit >= 0 ? "income" : "expense"} />
                  <StatCard title="Total Income" amount={data.summary.totalIncome} type="income" />
                  <StatCard title="Total Expense" amount={data.summary.totalExpense} type="expense" />
                </>
              )}
              {section === "supplier" && (
                <>
                  <StatCard title="Total Purchases" amount={data.summary.totalPurchases} type="neutral" />
                  <StatCard title="Total Payments Made" amount={data.summary.totalPayments} type="expense" />
                  <StatCard title="Total Payable Balance" amount={data.summary.totalBalance} type="expense" />
                </>
              )}
              {section === "customer" && (
                <>
                  <StatCard title="Total Sales" amount={data.summary.totalSales} type="income" />
                  <StatCard title="Total Receipts" amount={data.summary.totalReceived} type="income" />
                  <StatCard title="Total Receivable Balance" amount={data.summary.totalReceivable} type="income" />
                </>
              )}
            </div>

            {/* Charts Section */}
            {data.chartData && data.chartData.length > 0 && (
              <Card className="print:hidden">
                <CardHeader><CardTitle>Monthly Analytics</CardTitle></CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={v => `Rs ${v/1000}k`} />
                      <RechartsTooltip formatter={(value: any) => formatCurrency(Number(value) || 0)} />
                      <Legend />
                      {section === "finance" && (
                        <>
                          <Bar dataKey="income" name="Income" fill="#10b981" radius={[4,4,0,0]} />
                          <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4,4,0,0]} />
                        </>
                      )}
                      {section === "supplier" && (
                        <>
                          <Bar dataKey="purchases" name="Purchases" fill="#f59e0b" radius={[4,4,0,0]} />
                          <Bar dataKey="payments" name="Payments" fill="#3b82f6" radius={[4,4,0,0]} />
                        </>
                      )}
                      {section === "customer" && (
                        <>
                          <Bar dataKey="sales" name="Sales" fill="#10b981" radius={[4,4,0,0]} />
                          <Bar dataKey="receipts" name="Receipts" fill="#8b5cf6" radius={[4,4,0,0]} />
                        </>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Ledger Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Ledger</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      {section !== "finance" && <TableHead>Entity</TableHead>}
                      <TableHead>Description</TableHead>
                      <TableHead>Ref / Voucher</TableHead>
                      <TableHead className="text-right">{section === "finance" ? "Amount" : "Debit (In)"}</TableHead>
                      {section !== "finance" && <TableHead className="text-right">Credit (Out)</TableHead>}
                      {section !== "finance" && <TableHead className="text-right">Balance</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section === "finance" ? (
                      data.transactions.map((t: any) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-muted-foreground">{formatDate(t.date)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={t.type === "INCOME" ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}>
                              {t.category}
                            </Badge>
                            <span className="ml-2">{t.description}</span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{t.transactionRef}</TableCell>
                          <TableCell className={`text-right font-semibold ${t.type === "INCOME" ? "text-emerald-500" : "text-red-500"}`}>
                            {t.type === "INCOME" ? "+" : "-"}{formatCurrency(t.amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      data.ledger.map((l: any, i: number) => (
                        <TableRow key={`${l.id}-${i}`}>
                          <TableCell className="text-muted-foreground">{formatDate(l.date)}</TableCell>
                          <TableCell className="font-medium">{l.entityName}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="mr-2 mb-1">{l.type}</Badge>
                            <span className="text-sm">{l.description}</span>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{l.reference || "—"}</TableCell>
                          <TableCell className="text-right text-emerald-500 font-medium">{l.debit > 0 ? formatCurrency(l.debit) : "—"}</TableCell>
                          <TableCell className="text-right text-red-500 font-medium">{l.credit > 0 ? formatCurrency(l.credit) : "—"}</TableCell>
                          <TableCell className="text-right font-bold">{formatCurrency(l.balance)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </Tabs>
    </div>
  );
}

function StatCard({ title, amount, type }: { title: string, amount: number, type: "income" | "expense" | "neutral" }) {
  const colors = {
    income: "from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 text-emerald-500 bg-emerald-500/20",
    expense: "from-red-500/10 to-red-600/5 border-red-500/20 text-red-500 bg-red-500/20",
    neutral: "from-blue-500/10 to-blue-600/5 border-blue-500/20 text-blue-500 bg-blue-500/20",
  };
  const Icon = type === "income" ? TrendingUp : (type === "expense" ? TrendingDown : Wallet);
  
  return (
    <Card className={`bg-gradient-to-br ${colors[type].split(" ")[0]} ${colors[type].split(" ")[1]} ${colors[type].split(" ")[2]}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${colors[type].split(" ")[4]}`}><Icon className={`h-5 w-5 ${colors[type].split(" ")[3]}`} /></div>
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className={`text-xl font-bold ${colors[type].split(" ")[3]}`}>{formatCurrency(amount)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
