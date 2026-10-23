// src/app/api/backups/settings/route.ts - Backup folder, schedule, retention and passphrase for this computer.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { backupSettings, checkFolder, protectPassphrase } from "@/lib/backup/runtime";
import { BackupError } from "@/lib/backup/service";

const schema = z.object({
  enabled: z.boolean().optional(),
  directory: z.string().trim().max(500).optional(),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional(),
  frequentMinutes: z.number().int().min(0).max(1440).optional(),
  keepDaily: z.number().int().min(1).max(365).optional(),
  keepFrequent: z.number().int().min(0).max(500).optional(),
  passphrase: z.string().min(12, "At least 12 characters").max(200).optional(),
  passphraseConfirm: z.string().optional(),
});

export async function PUT(request: NextRequest) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  const { passphrase, passphraseConfirm, ...rest } = parsed.data;
  try {
    if (rest.directory) checkFolder(rest.directory);
    const data: Record<string, unknown> = { ...rest, updatedById: auth.user.id };
    if (passphrase !== undefined) {
      if (passphrase !== passphraseConfirm) return NextResponse.json({ error: "The two passphrases do not match" }, { status: 400 });
      data.protectedPassphrase = await protectPassphrase(passphrase);
    }
    const current = await backupSettings();
    if ((rest.enabled ?? current.enabled) && !(rest.directory ?? current.directory)) return NextResponse.json({ error: "Choose a backup folder before turning backups on" }, { status: 400 });
    await prisma.backupSettings.update({ where: { id: "local" }, data });
    await prisma.auditLog.create({ data: { entity: "BackupSettings", entityId: "local", action: "UPDATE", userId: auth.user.id, after: JSON.stringify({ ...rest, passphraseChanged: passphrase !== undefined }) } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof BackupError ? 400 : 500 });
  }
}
