// src/app/dashboard/sales/new/page.tsx - New Sale: the Customer Invoice / Cash Sale screen laid out like the old program
import { catalogReady } from "@/lib/accounting/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UNIT_FIELDS, withSaleUnits } from "@/lib/sales/units";
import { SPEC_FIELDS } from "@/lib/product-spec";
import PaperSaleClient from "./paper-sale-client";

// ?walkin=1 starts on a walk-in cash sale (Classic menu: Cash Sale)
export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ walkin?: string }> }) {
  const user = await getAuthUser();
  await catalogReady(); // product and party numbers (Report 32 phase 1)
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
      select: { id: true, name: true, phone: true, partyNo: true }, 
      orderBy: { visitCount: "desc" },
      take: 10,
    }),
  ]);

  return (
    <PaperSaleClient
      key={walkIn ? "walk-in" : "customer"}
      startWalkIn={walkIn}
      initialItems={JSON.parse(JSON.stringify(initialComponents.map(withSaleUnits)))}
      initialCustomers={JSON.parse(JSON.stringify(initialCustomers.map((c) => ({ ...c, phone: c.phone ?? "" }))))}
    />
  );
}