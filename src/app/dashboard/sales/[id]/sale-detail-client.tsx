"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart, User, Clock, CheckCircle2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

interface SaleData {
  id: string; invoiceNumber: string; customer: { name: string; phone: string; email: string } | null;
  walkInName: string | null; subtotal: number; discount: number; tax: number; total: number;
  profit: number; paymentMethod: string; paymentStatus: string; createdAt: string; notes: string | null;
  user: { name: string };
  items: { id: string; quantity: number; unitPrice: number; totalPrice: number; component: { name: string; sku: string } }[];
}

export function SaleDetailClient({ sale }: { sale: SaleData }) {
  const router = useRouter();
  
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Invoice {sale.invoiceNumber}</h1>
              <Badge variant={sale.paymentStatus === "PAID" ? "success" : "secondary"}>{sale.paymentStatus}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{formatDate(sale.createdAt)} · Handled by {sale.user.name}</p>
          </div>
        </div>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Download PDF
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Customer Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" /> Customer Details
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {sale.customer ? (
              <>
                <p><strong>Name:</strong> {sale.customer.name}</p>
                {sale.customer.email && <p><strong>Email:</strong> {sale.customer.email}</p>}
                {sale.customer.phone && <p><strong>Phone:</strong> {sale.customer.phone}</p>}
              </>
            ) : (
              <p><strong>Walk-in Customer:</strong> {sale.walkInName || "Unknown"}</p>
            )}
          </CardContent>
        </Card>

        {/* Payment Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" /> Payment Info
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment Method</span>
              <span className="font-medium">{sale.paymentMethod}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">{sale.paymentStatus}</span>
            </div>
            {sale.notes && (
              <div className="pt-2 mt-2 border-t text-muted-foreground italic">
                "{sale.notes}"
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" /> Order Items
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item / Component</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.component.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{item.component.sku}</div>
                  </TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(item.totalPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          <div className="p-4 border-t space-y-2 bg-muted/20">
            <div className="flex justify-end gap-16 text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="w-24 text-right">{formatCurrency(sale.subtotal)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="flex justify-end gap-16 text-sm text-red-500">
                <span>Discount</span>
                <span className="w-24 text-right">-{formatCurrency(sale.discount)}</span>
              </div>
            )}
            {sale.tax > 0 && (
              <div className="flex justify-end gap-16 text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span className="w-24 text-right">{formatCurrency(sale.tax)}</span>
              </div>
            )}
            <div className="flex justify-end gap-16 text-base font-bold pt-2 mt-2 border-t">
              <span>Total</span>
              <span className="w-24 text-right text-primary">{formatCurrency(sale.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
