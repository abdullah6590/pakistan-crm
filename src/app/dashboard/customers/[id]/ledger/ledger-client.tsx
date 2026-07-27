"use client";

import { useState, useEffect } from "react";
import { BookOpen, Printer, ArrowLeft, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { toast } from "sonner";

export default function CustomerLedgerClient({ customerId }: { customerId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ customerId });
      if (dateRange.start) params.append("startDate", dateRange.start);
      if (dateRange.end) params.append("endDate", dateRange.end);
      const res = await fetch(`/api/customer-ledger?${params.toString()}`);
      const json = await res.json();
      if (res.ok) setData(json);
      else toast.error(json.error);
    } catch {
      toast.error("Failed to load ledger");
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [customerId, dateRange]);

  const handlePrint = () => window.print();

  return (
    <div className="space-y-6 p-6 print:p-0">
      <div className="flex items-center gap-4 mb-4 print:hidden">
        <Link href="/dashboard/customers"><Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <span className="text-sm text-muted-foreground">Back to Customers</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customer Ledger</h1>
          {data && (
            <p className="text-muted-foreground mt-1">
              Account statement for <span className="font-semibold text-foreground">{data.customer.name}</span>
              {data.customer.phone && ` (${data.customer.phone})`}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-3 print:hidden">
          <Input type="date" value={dateRange.start} onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))} className="w-auto" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" value={dateRange.end} onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))} className="w-auto" />
          <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4 mr-2" /> Print</Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground">Loading ledger data...</div>
      ) : data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:grid-cols-3">
            <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(data.summary.totalSales)}</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total Received</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(data.summary.totalReceived)}</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Current Balance Receivable</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(data.summary.balanceDue)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Ledger Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description & Details</TableHead>
                    <TableHead>Ref/Voucher</TableHead>
                    <TableHead className="text-right">Debit (In)</TableHead>
                    <TableHead className="text-right">Credit (Out)</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ledger.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        No transactions found for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.ledger.map((entry: any, i: number) => (
                      <TableRow key={`${entry.id}-${i}`}>
                        <TableCell className="text-muted-foreground">{formatDate(entry.date)}</TableCell>
                        <TableCell>
                          <Badge variant={entry.type === "SALE" ? "default" : "secondary"}>
                            {entry.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{entry.description}</div>
                          {entry.details && <div className="text-xs text-muted-foreground mt-1 truncate max-w-sm">{entry.details}</div>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{entry.reference || "—"}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600 dark:text-emerald-400">
                          {entry.debit > 0 ? formatCurrency(entry.debit) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium text-blue-600 dark:text-blue-400">
                          {entry.credit > 0 ? formatCurrency(entry.credit) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-amber-600 dark:text-amber-400">
                          {formatCurrency(entry.balance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
