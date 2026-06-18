// src/app/(dashboard)/sales/[id]/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { SaleDetailClient } from "./sale-detail-client";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      user: { select: { name: true } },
      items: {
        include: {
          component: { select: { name: true, sku: true } },
        },
      },
    },
  });

  if (!sale) notFound();

  return <SaleDetailClient sale={JSON.parse(JSON.stringify(sale))} />;
}
