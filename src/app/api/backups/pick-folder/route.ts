// src/app/api/backups/pick-folder/route.ts - Open the Windows folder picker on this computer.
// Works where the application runs on the user's own Windows computer (desktop app or office server console).
import { NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { nodeRole } from "@/lib/tenancy/config";
import { pickFolder } from "@/lib/backup/runtime";

export async function POST() {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  if (nodeRole() === "cloud") return NextResponse.json({ error: "Type the folder path on the server; the picker opens only on desktop computers" }, { status: 409 });
  try {
    return NextResponse.json({ directory: await pickFolder() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
