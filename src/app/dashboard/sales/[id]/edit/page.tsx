// src/app/dashboard/sales/[id]/edit/page.tsx - Correct a saved bill (Report 28 §3). The bill gets a new revision with
// the same number; its payments move with it. Only an administrator or the bill's maker may edit it.
import { catalogReady } from "@/lib/accounting/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadBooksBill } from "@/lib/sales/books-queries";
import { mayEditBill } from "@/lib/sales/books-sales";
import { screenBill, startingLists } from "@/lib/sales/desk-data";
import PaperSaleClient from "../../new/paper-sale-client";

export const dynamic = "force-dynamic";

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  await catalogReady(); // product and party numbers (Report 32 phase 1)
  if (!user) redirect("/login");
  const { id } = await params;

  const bill = await loadBooksBill(prisma, id);
  if (!bill) {
    // A bill from before Sales moved to Books: read-only
    if (await prisma.sale.findUnique({ where: { id }, select: { id: true } })) redirect(`/dashboard/sales/${id}`);
    notFound();
  }
  const { doc } = bill;
  if (doc.status !== "POSTED" || !can(user.role, "sales", "write") || !mayEditBill({ id: user.id, role: user.role }, doc)) redirect(`/dashboard/sales/${id}`);

  // The same saved-bill mapping as the invoice desk (one copy, so a new field reaches both screens)
  const lists = await startingLists(prisma);
  return (
    <PaperSaleClient {...lists} editBill={await screenBill(prisma, bill)} />
  );
}
