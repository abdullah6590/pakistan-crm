// src/app/(dashboard)/settings/page.tsx - Settings (Server)
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "./settings-client";
import prisma from "@/lib/prisma";
import { interfaceKey, parseLayout } from "@/lib/interface-pref";

export default async function SettingsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const pref = await prisma.setting.findUnique({ where: { key: interfaceKey(user.id) } });
  return <SettingsClient user={JSON.parse(JSON.stringify({ id: user.id, name: user.name, email: user.email, role: user.role }))} layout={parseLayout(pref?.value)} />;
}