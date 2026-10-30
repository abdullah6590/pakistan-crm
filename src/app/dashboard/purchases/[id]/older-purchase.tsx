// src/app/dashboard/purchases/[id]/older-purchase.tsx - A purchase entered before Purchases moved to Books (Report 30):
// shown as it was recorded, read-only.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Older {
  id: string; poNumber: string; invoiceRef: string | null; total: number; paidAmount: number; paymentStatus: string; notes: string | null; createdAt: string;
  supplier: { name: string; phone: string | null }; user: { name: string };
  items: { id: string; quantity: number; unitCost: number; totalCost: number; component: { name: string; sku: string } }[];
}

export default function OlderPurchase({ purchase: p }: { purchase: Older }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/purchases/older" aria-label="Back to older purchases" className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-accent"><ArrowLeft className="h-5 w-5" aria-hidden /></Link>
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">{p.poNumber}</h1><Badge variant="secondary">older purchase, read-only</Badge></div>
          <p className="text-sm text-muted-foreground">{formatDate(p.createdAt)} · {p.supplier.name} · entered by {p.user.name}</p>
        </div>
      </div>
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        This purchase was entered before Purchases moved to Books. It is kept exactly as recorded and cannot be changed; new purchases and payments are entered on Books.
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {p.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.component.name}<div className="text-xs font-mono text-muted-foreground">{i.component.sku}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(i.unitCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(i.totalCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t p-4 text-sm space-y-1">
            <div>Total {formatCurrency(p.total)} · paid {formatCurrency(p.paidAmount)} · status {p.paymentStatus.toLowerCase()}</div>
            {p.invoiceRef && <div>Supplier bill: {p.invoiceRef}</div>}
            {p.notes && <div className="text-muted-foreground">{p.notes}</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
