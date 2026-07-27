// src/app/dashboard/customer-payments/page.tsx
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import CustomerPaymentsClient from "./payments-client";

export default async function CustomerPaymentsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const payments = await prisma.customerPayment.findMany({
    include: { customer: { select: { id: true, name: true, phone: true } } },
    orderBy: { date: "desc" },
    take: 200,
  });

  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    select: { id: true, name: true, phone: true, balanceDue: true },
    orderBy: { name: "asc" },
  });

  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <CustomerPaymentsClient
      payments={JSON.parse(JSON.stringify(payments))}
      customers={JSON.parse(JSON.stringify(customers))}
      totalReceived={totalReceived}
    />
  );
}
