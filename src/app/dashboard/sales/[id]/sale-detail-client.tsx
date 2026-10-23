"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart, User, FileText, Download, Pencil, Printer, History } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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

interface EditEntry { id: string; at: string; by: string; reason: string | null; totalBefore?: number; totalAfter?: number }

interface Props {
  sale: SaleData;
  business: { name: string; address: string };
  words: string;
  edits: EditEntry[];
  canEdit: boolean;
  printedBy: string;
}

const cell = "border-b border-dotted border-gray-400 px-2 py-1";
const num = `${cell} text-right tabular-nums`;

export function SaleDetailClient({ sale, business, words, edits, canEdit, printedBy }: Props) {
  const router = useRouter();
  const customerName = sale.customer?.name ?? sale.walkInName ?? "Walk-in customer";
  const lastEdit = edits.at(-1);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ─── Screen ───────────────────────────────────────────── */}
      <div className="space-y-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/sales")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Invoice {sale.invoiceNumber}</h1>
                <Badge variant={sale.paymentStatus === "PAID" ? "success" : "secondary"}>{sale.paymentStatus}</Badge>
                {edits.length > 0 && <Badge variant="outline">Edited</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{formatDate(sale.createdAt)} · Handled by {sale.user.name}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="outline" className="gap-2" onClick={() => router.push(`/dashboard/sales/${sale.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit Bill
              </Button>
            )}
            {/* The print window also offers "Save as PDF" / "Microsoft Print to PDF" as a printer */}
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <a className={buttonVariants({ variant: "outline", className: "gap-2" })} href={`/api/sales/${sale.id}/pdf`} download={`Bill-${sale.invoiceNumber}.pdf`}>
              <Download className="h-4 w-4" /> Download PDF
            </a>
          </div>
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
                  &ldquo;{sale.notes}&rdquo;
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

        {edits.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" /> Changes to this bill
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {edits.map(e => (
                <div key={e.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                  <span>{formatDate(e.at)} · {e.by}{e.reason ? ` — ${e.reason}` : ""}</span>
                  {e.totalBefore !== undefined && e.totalAfter !== undefined && (
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(e.totalBefore)} → {formatCurrency(e.totalAfter)}</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── Printed bill (only when printing) ────────────────── */}
      <div className="hidden print:block bg-white text-black text-sm">
        <div className="text-center">
          <div className="text-xl font-bold">{business.name}</div>
          {business.address && <div>{business.address}</div>}
          <div className="mt-1 text-lg font-semibold uppercase tracking-wide">Sale Bill</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
          <div><b>Bill No:</b> {sale.invoiceNumber}</div>
          <div className="text-right"><b>Date:</b> {formatDate(sale.createdAt)}</div>
          <div><b>Customer:</b> {customerName}{sale.customer?.phone ? ` (${sale.customer.phone})` : ""}</div>
          <div className="text-right"><b>Payment:</b> {sale.paymentMethod} · {sale.paymentStatus}</div>
        </div>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-y border-black">
              <th className="px-2 py-1 text-left">S.No</th>
              <th className="px-2 py-1 text-left">Item</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Rate</th>
              <th className="px-2 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, i) => (
              <tr key={item.id} className="break-inside-avoid">
                <td className={cell}>{i + 1}</td>
                <td className={cell}>{item.component.name}{item.component.sku ? ` (${item.component.sku})` : ""}</td>
                <td className={num}>{item.quantity}</td>
                <td className={num}>{formatCurrency(item.unitPrice)}</td>
                <td className={num}>{formatCurrency(item.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div className="space-y-1">
            <div><b>Amount in words:</b> {words}</div>
            {sale.notes && <div><b>Notes:</b> {sale.notes}</div>}
            {lastEdit && <div className="text-xs">Corrected on {formatDate(lastEdit.at)} by {lastEdit.by}</div>}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between"><span>Sub-total</span><span className="tabular-nums">{formatCurrency(sale.subtotal)}</span></div>
            {sale.discount > 0 && <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-{formatCurrency(sale.discount)}</span></div>}
            {sale.tax > 0 && <div className="flex justify-between"><span>Tax</span><span className="tabular-nums">{formatCurrency(sale.tax)}</span></div>}
            <div className="flex justify-between border-t border-black font-bold"><span>Total</span><span className="tabular-nums">{formatCurrency(sale.total)}</span></div>
          </div>
        </div>
        <div className="mt-6 text-xs text-gray-600">Printed by {printedBy} · {formatDate(new Date())}</div>
      </div>
    </div>
  );
}
