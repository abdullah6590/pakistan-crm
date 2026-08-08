"use client";

import { useEffect } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

interface Props {
  moduleName: string;
  data: any[];
  params: { [key: string]: string };
}

export default function PrintClient({ moduleName, data, params }: Props) {
  useEffect(() => {
    // Only auto-print if there are 500 or fewer records to avoid massive accidental prints
    if (data.length <= 500) {
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [data.length]);

  const renderTableHeaders = () => {
    switch (moduleName) {
      case "sales": return (
        <>
          <TableHead>Date</TableHead>
          <TableHead>Invoice #</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </>
      );
      case "purchases": return (
        <>
          <TableHead>Date</TableHead>
          <TableHead>PO #</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </>
      );
      case "inventory": return (
        <>
          <TableHead>SKU</TableHead>
          <TableHead>Item Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Stock</TableHead>
          <TableHead className="text-right">Price</TableHead>
        </>
      );
      case "finance": return (
        <>
          <TableHead>Date</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </>
      );
      case "customers": return (
        <>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead className="text-right">Balance Due</TableHead>
        </>
      );
      case "suppliers": return (
        <>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead className="text-right">Balance Due</TableHead>
        </>
      );
      case "expenditures": return (
        <>
          <TableHead>Date</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </>
      );
      case "accounts": return (
        <>
          <TableHead>Account Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Bank</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </>
      );
      default: return null;
    }
  };

  const renderTableRow = (item: any) => {
    switch (moduleName) {
      case "sales": return (
        <TableRow key={item.id}>
          <TableCell>{formatDate(item.createdAt)}</TableCell>
          <TableCell>{item.invoiceNumber}</TableCell>
          <TableCell>{item.customer?.name || item.walkInName || "Walk-in"}</TableCell>
          <TableCell>{item.paymentStatus}</TableCell>
          <TableCell className="text-right">{formatCurrency(item.total)}</TableCell>
        </TableRow>
      );
      case "purchases": return (
        <TableRow key={item.id}>
          <TableCell>{formatDate(item.createdAt)}</TableCell>
          <TableCell>{item.poNumber}</TableCell>
          <TableCell>{item.supplier?.name || "N/A"}</TableCell>
          <TableCell>{item.paymentStatus}</TableCell>
          <TableCell className="text-right">{formatCurrency(item.total)}</TableCell>
        </TableRow>
      );
      case "inventory": return (
        <TableRow key={item.id}>
          <TableCell>{item.sku}</TableCell>
          <TableCell>{item.name}</TableCell>
          <TableCell>{item.category?.name || "N/A"}</TableCell>
          <TableCell>{item.quantity}</TableCell>
          <TableCell className="text-right">{formatCurrency(item.sellingPrice)}</TableCell>
        </TableRow>
      );
      case "finance": return (
        <TableRow key={item.id}>
          <TableCell>{formatDate(item.date)}</TableCell>
          <TableCell>{item.transactionRef}</TableCell>
          <TableCell>{item.description}</TableCell>
          <TableCell>{item.type}</TableCell>
          <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
        </TableRow>
      );
      case "customers": return (
        <TableRow key={item.id}>
          <TableCell>{item.name}</TableCell>
          <TableCell>{item.company || "-"}</TableCell>
          <TableCell>{item.phone || "-"}</TableCell>
          <TableCell className="text-right font-bold text-red-600">{formatCurrency(item.balanceDue)}</TableCell>
        </TableRow>
      );
      case "suppliers": return (
        <TableRow key={item.id}>
          <TableCell>{item.name}</TableCell>
          <TableCell>{item.company || "-"}</TableCell>
          <TableCell>{item.phone || "-"}</TableCell>
          <TableCell className="text-right font-bold text-red-600">{formatCurrency(item.balanceDue)}</TableCell>
        </TableRow>
      );
      case "expenditures": return (
        <TableRow key={item.id}>
          <TableCell>{formatDate(item.date)}</TableCell>
          <TableCell>{item.category}</TableCell>
          <TableCell>{item.description}</TableCell>
          <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
        </TableRow>
      );
      case "accounts": return (
        <TableRow key={item.id}>
          <TableCell>{item.name}</TableCell>
          <TableCell>{item.type}</TableCell>
          <TableCell>{item.bankName || "-"}</TableCell>
          <TableCell className="text-right">{formatCurrency(item.currentBalance)}</TableCell>
        </TableRow>
      );
      default: return null;
    }
  };

  return (
    <div className="bg-white text-black min-h-screen p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between print:hidden mb-6">
          <h1 className="text-2xl font-bold capitalize">{moduleName} Print View</h1>
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => window.close()}>Close</Button>
            <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print Document</Button>
          </div>
        </div>

        <div className="border-b pb-4 mb-4">
          <h2 className="text-3xl font-bold uppercase tracking-wider">{moduleName} REPORT</h2>
          <p className="text-sm text-gray-500 mt-2">Generated on {new Date().toLocaleString()}</p>
          
          {Object.keys(params).length > 1 && (
            <div className="mt-4 p-3 bg-gray-50 border rounded-lg">
              <h3 className="font-semibold text-sm mb-2">Applied Filters:</h3>
              <ul className="text-sm flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(params).map(([k, v]) => k !== "module" && (
                  <li key={k} className="text-gray-700 capitalize">
                    <strong>{k}:</strong> {v}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm mt-4 font-semibold text-blue-600">Total Records: {data.length}</p>
        </div>

        <div className="bg-white">
          <Table className="border-collapse border border-gray-200">
            <TableHeader className="bg-gray-100">
              <TableRow>
                {renderTableHeaders()}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(renderTableRow)}
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-gray-500">
                    No data found for the applied filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
