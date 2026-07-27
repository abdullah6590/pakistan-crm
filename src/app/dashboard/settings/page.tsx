// src/app/(dashboard)/settings/page.tsx - Settings (Server)
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  return <SettingsClient user={JSON.parse(JSON.stringify({ id: user.id, name: user.name, email: user.email, role: user.role }))} />;
}