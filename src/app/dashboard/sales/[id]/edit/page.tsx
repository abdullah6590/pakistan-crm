// src/app/dashboard/sales/[id]/edit/page.tsx - Edit a saved sale bill (Server)
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import NewSaleClient from "../../new/new-sale-client";

export const dynamic = "force-dynamic";

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { component: { select: { id: true, name: true, sku: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true } } } },
    },
  });
  if (!sale) notFound();
  // Same rule as the API: an administrator, or the person who made the bill
  if (!can(user.role, "sales", "write") || (user.role !== "ADMIN" && sale.userId !== user.id)) redirect(`/dashboard/sales/${id}`);

  const [initialComponents, initialCustomers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
      orderBy: { totalSold: "desc" },
      take: 15,
      select: { id: true, name: true, sku: true, quantity: true, unitCost: true, unitPrice: true, minQuantity: true },
    }),
    prisma.customer.findMany({
      where: { isActive: true },
      select: { id: true, name: true, phone: true },
      orderBy: { visitCount: "desc" },
      take: 10,
    }),
  ]);

  return (
    <NewSaleClient
      initialComponents={JSON.parse(JSON.stringify(initialComponents))}
      initialCustomers={JSON.parse(JSON.stringify(initialCustomers))}
      editSale={JSON.parse(JSON.stringify({
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer,
        walkInName: sale.walkInName,
        paymentMethod: sale.paymentMethod,
        paymentStatus: sale.paymentStatus,
        discount: sale.discount,
        tax: sale.tax,
        notes: sale.notes,
        items: sale.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost, component: i.component })),
      }))}
    />
  );
}
