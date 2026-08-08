import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import StatementClient from "./statement-client";

export default async function SupplierStatementPage({ params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchases: {
        orderBy: { createdAt: "asc" },
      },
      supplierPayments: {
        orderBy: { date: "asc" },
      },
    }
  });

  if (!supplier) {
    return <div className="p-10 text-center">Supplier not found</div>;
  }

  return <StatementClient supplier={JSON.parse(JSON.stringify(supplier))} />;
}
