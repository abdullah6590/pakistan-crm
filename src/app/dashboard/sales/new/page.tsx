// src/app/(dashboard)/sales/new/page.tsx - New Sale (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import { SPEC_FIELDS } from "@/lib/product-spec";
import NewSaleClient from "./new-sale-client";

// ?walkin=1 starts on a walk-in cash sale (Classic menu: Cash Sale)
export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ walkin?: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const walkIn = (await searchParams).walkin === "1";

  const [initialComponents, initialCustomers] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
      orderBy: { totalSold: "desc" },
      take: 15,
      select: {
        id: true, name: true, sku: true, quantity: true,
        unitCost: true, unitPrice: true, minQuantity: true, ...SPEC_FIELDS, ...UNIT_FIELDS,
      },
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
      key={walkIn ? "walk-in" : "customer"}
      startWalkIn={walkIn}
      initialComponents={JSON.parse(JSON.stringify(initialComponents.map(withSaleUnits)))}
      initialCustomers={JSON.parse(JSON.stringify(initialCustomers))}
    />
  );
}