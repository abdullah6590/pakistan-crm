import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import StatementClient from "./statement-client";

export default async function CustomerStatementPage({ params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { id } = await params;
  
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: {
        orderBy: { createdAt: "asc" },
      },
      customerPayments: {
        orderBy: { date: "asc" },
      },
    }
  });

  if (!customer) {
    return <div className="p-10 text-center">Customer not found</div>;
  }

  return <StatementClient customer={JSON.parse(JSON.stringify(customer))} />;
}
