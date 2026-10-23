// src/app/dashboard/accounting/new/[type]/page.tsx - Entry screen for any accounting document type.
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { DOCUMENT_TYPES } from "@/lib/accounting/meta";
import { unitConfigFor } from "@/lib/accounting/posting";
import { accountingReady } from "@/lib/accounting/server";
import { PageHeader } from "@/components/shared/page-header";
import DocumentForm from "./document-form";
import ReturnForm, { ReturnSource } from "./return-form";
import { dec, sub, toPlain } from "@/lib/domain/decimal";

export default async function NewDocumentPage({ params }: { params: Promise<{ type: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { type } = await params;
  const meta = DOCUMENT_TYPES[type];
  // Expense postings of charges are created only by "Post as expense" on the Charges screen
  if (!meta || type === "CHARGE_EXPENSE") notFound();
  if (!can(user.role, DOCUMENT_RESOURCE[type], "write")) redirect("/dashboard/accounting");
  await accountingReady();

  const [components, accounts] = await Promise.all([
    meta.form === "items"
      ? prisma.component.findMany({ where: { isActive: true }, include: { unitProfile: { include: { conversions: true } } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    prisma.ledgerAccount.findMany({ where: { isActive: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
  ]);
  if (meta.form === "return") {
    const originals = await prisma.accountingDocument.findMany({
      where: { type: { in: type === "SALE_RETURN" ? ["SALE_INVOICE", "CASH_SALE"] : ["PURCHASE_INVOICE"] }, status: "POSTED" },
      include: { lines: { orderBy: { lineNo: "asc" }, include: { component: { include: { unitProfile: { include: { conversions: true } } } } } }, partyAccount: { select: { name: true } }, returns: { where: { status: "POSTED" }, include: { lines: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const sources: ReturnSource[] = originals.map((d) => ({
      id: d.id, docNo: d.docNo, partyName: d.partyAccount?.name ?? null,
      lines: d.lines.map((l) => {
        const returned = d.returns.flatMap((r) => r.lines).filter((x) => x.returnOfLineNo === l.lineNo).reduce((a, x) => a + dec(x.baseQuantity), BigInt(0));
        return {
          lineNo: l.lineNo, description: l.description, unit: l.unit, baseUnit: l.component ? unitConfigFor(l.component).cfg.baseUnit : "unit",
          quantity: l.quantity, loose: l.loose, unitPrice: l.unitPrice, baseQuantity: l.baseQuantity, returnable: toPlain(sub(dec(l.baseQuantity), returned)),
        };
      }),
    }));
    return (
      <div className="space-y-6">
        <PageHeader title={`New ${meta.title.toLowerCase()}`} description={meta.description} />
        <ReturnForm type={type} sources={sources} cashBank={accounts.filter((a) => a.kind === "CASH_BANK").map((a) => ({ id: a.id, name: a.name }))} today={new Date().toISOString().slice(0, 10)} />
      </div>
    );
  }

  const items = components.map((c) => {
    const { cfg, confirmed } = unitConfigFor(c);
    return { id: c.id, name: c.name, sku: c.sku, cfg, confirmed, dims: { x: c.dimensionX, y: c.dimensionY, gsm: c.gsm, divisor: c.divisor } };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={`New ${meta.title.toLowerCase()}`} description={meta.description} />
      <DocumentForm
        type={type}
        items={items}
        accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, subType: a.subType }))}
        today={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
