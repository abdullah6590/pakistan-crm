// src/app/(dashboard)/partners/page.tsx - Partners (Server)
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import PartnersClient from "./partners-client";

export default async function PartnersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const partners = await prisma.partner.findMany({ orderBy: { createdAt: "desc" } });

  return <PartnersClient partners={JSON.parse(JSON.stringify(partners))} />;
}