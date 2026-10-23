// src/app/dashboard/accounting/documents/page.tsx - Document register for one document type, with filters.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { DOCUMENT_TYPES, STATUS_LABEL, money, formatDate } from "@/lib/accounting/meta";
import { getSetting } from "@/lib/accounting/setup";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  POSTED: "default", PENDING_APPROVAL: "secondary", REJECTED: "destructive", CANCELLED: "outline",
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const type = sp.type ?? "";
  const meta = DOCUMENT_TYPES[type];
  if (!meta) notFound();
  if (!can(user.role, DOCUMENT_RESOURCE[type], "read")) redirect("/dashboard/accounting");

  const search = sp.search?.trim();
  const documents = await prisma.accountingDocument.findMany({
    where: {
      type,
      ...(sp.status ? { status: sp.status } : {}),
      ...(sp.from || sp.to ? { date: { ...(sp.from ? { gte: new Date(sp.from) } : {}), ...(sp.to ? { lte: new Date(`${sp.to}T23:59:59.999Z`) } : {}) } } : {}),
      ...(search ? { OR: [{ docNo: { contains: search } }, { remarks: { contains: search } }, { partyAccount: { name: { contains: search } } }] } : {}),
    },
    include: { partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const dateFormat = await getSetting(prisma, "DATE_FORMAT");

  return (
    <div className="space-y-6">
      <PageHeader
        title={meta.plural}
        description={meta.description}
        icon={FileText}
        actions={can(user.role, DOCUMENT_RESOURCE[type], "write") && (
          <Link className={buttonVariants({ size: "sm" })} href={`/dashboard/accounting/new/${type}`}><Plus className="mr-1 h-4 w-4" />New</Link>
        )}
      />
      <Card>
        <CardContent className="p-4">
          <form className="grid gap-2 md:grid-cols-5">
            <input type="hidden" name="type" value={type} />
            <Input name="search" placeholder="Number, party or remarks" defaultValue={sp.search ?? ""} />
            <Input name="from" type="date" defaultValue={sp.from ?? ""} />
            <Input name="to" type="date" defaultValue={sp.to ?? ""} />
            <select name="status" defaultValue={sp.status ?? ""} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).filter(([k]) => k !== "DRAFT").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className={buttonVariants({ variant: "outline" })} type="submit">Filter</button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Party / account</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No documents</TableCell></TableRow>
            )}
            {documents.map((d) => (
              <TableRow key={d.id}>
                <TableCell><Link className="font-medium text-primary hover:underline" href={`/dashboard/accounting/documents/${d.id}`}>{d.docNo}</Link></TableCell>
                <TableCell>{formatDate(d.date, dateFormat)}</TableCell>
                <TableCell>{d.partyAccount?.name ?? d.cashAccount?.name ?? "-"}</TableCell>
                <TableCell className="max-w-xs truncate">{d.remarks ?? ""}</TableCell>
                <TableCell className="text-right tabular-nums">{money(d.total, d.type === "PURCHASE_INVOICE" ? 2 : 0)}</TableCell>
                <TableCell className="space-x-1">
                  <Badge variant={STATUS_VARIANT[d.status] ?? "outline"}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
                  {d.hasNegativeStock && <Badge variant="destructive">Negative stock</Badge>}
                  {d.hasCostEstimate && <Badge variant="secondary">Cost estimated</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
