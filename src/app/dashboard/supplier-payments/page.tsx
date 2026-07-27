// src/app/dashboard/supplier-payments/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SupplierPaymentsClient from "./payments-client";

export default async function SupplierPaymentsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const payments = await prisma.supplierPayment.findMany({
    include: { supplier: { select: { id: true, name: true, company: true } } },
    orderBy: { date: "desc" },
    take: 200,
  });

  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true, company: true, balanceDue: true },
    orderBy: { name: "asc" },
  });

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <SupplierPaymentsClient
      payments={JSON.parse(JSON.stringify(payments))}
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      totalPaid={totalPaid}
    />
  );
}
