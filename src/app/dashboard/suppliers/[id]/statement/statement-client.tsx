"use client";

import { useEffect, useMemo } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function StatementClient({ supplier }: { supplier: any }) {
  
  const ledger = useMemo(() => {
    const entries = [
      ...supplier.purchases.map((p: any) => ({
        id: p.id,
        date: p.createdAt,
        type: "PURCHASE",
        description: `Purchase ${p.poNumber}`,
        ref: p.poNumber,
        credit: p.total,
        debit: 0
      })),
      ...supplier.supplierPayments.map((p: any) => ({
        id: p.id,
        date: p.date,
        type: "PAYMENT",
        description: `Payment ${p.paymentMethod}`,
        ref: p.chequeNumber || "-",
        credit: 0,
        debit: p.amount
      }))
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let balance = 0;
    return entries.map(e => {
      // For suppliers: Purchases increase what we owe (credit), Payments decrease what we owe (debit)
      // So balance = sum(credit) - sum(debit). A positive balance means we owe the supplier.
      balance += e.credit - e.debit;
      return { ...e, balance };
    });
  }, [supplier]);

  return (
    <div className="bg-white text-black min-h-screen p-8 print:p-0">
      <div className="max-w-4xl mx-auto border print:border-0 rounded-lg p-8 print:p-0">
        
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold uppercase text-gray-800 tracking-wider">Supplier Statement</h1>
            <p className="text-gray-500 mt-1">Generated: {new Date().toLocaleString()}</p>
          </div>
          <div className="print:hidden flex gap-2">
            <Button variant="outline" onClick={() => window.history.back()}>Back</Button>
            <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print Statement</Button>
          </div>
        </div>

        <div className="flex justify-between items-end border-b pb-6 mb-6">
          <div>
            <h3 className="font-semibold text-gray-500 uppercase text-xs tracking-wider mb-2">Supplier Details</h3>
            <p className="text-xl font-bold">{supplier.name}</p>
            {supplier.company && <p className="text-gray-700">{supplier.company}</p>}
            {supplier.phone && <p className="text-gray-700">{supplier.phone}</p>}
            {supplier.email && <p className="text-gray-700">{supplier.email}</p>}
            {supplier.address && <p className="text-gray-700">{supplier.address}, {supplier.city}</p>}
          </div>
          <div className="text-right">
            <h3 className="font-semibold text-gray-500 uppercase text-xs tracking-wider mb-2">Account Summary</h3>
            <p className="text-gray-700">Total Purchased: {formatCurrency(supplier.totalPurchased)}</p>
            <p className="text-2xl font-bold text-red-600 mt-2">
              Balance Payable: {formatCurrency(supplier.balanceDue)}
            </p>
          </div>
        </div>

        <Table className="border-collapse border border-gray-200">
          <TableHeader className="bg-gray-100">
            <TableRow>
              <TableHead className="w-32">Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead className="text-right text-red-700">Credit (Billed)</TableHead>
              <TableHead className="text-right text-green-700">Debit (Paid)</TableHead>
              <TableHead className="text-right font-bold">Balance Payable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.map(entry => (
              <TableRow key={entry.id + entry.type}>
                <TableCell>{formatDate(entry.date)}</TableCell>
                <TableCell>{entry.description}</TableCell>
                <TableCell>{entry.ref}</TableCell>
                <TableCell className="text-right text-red-700">
                  {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                </TableCell>
                <TableCell className="text-right text-green-700">
                  {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                </TableCell>
                <TableCell className="text-right font-bold border-l bg-gray-50/50">
                  {formatCurrency(entry.balance)}
                </TableCell>
              </TableRow>
            ))}
            {ledger.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-gray-500">
                  No transactions found for this supplier.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="mt-16 text-center text-sm text-gray-400 print:block hidden">
          <p>Generated by Pakistan CRM.</p>
        </div>

      </div>
    </div>
  );
}
