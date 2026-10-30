// src/app/api/backups/restore/route.ts - Restore from a backup (Report 23). Administrators only.
// prepare: validate and recover into an isolated copy (nothing live changes). confirm: typed phrase + safety backup,
// then the swap is staged for the next start. rescue: queue a failed computer's unsent entries on this one.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/permissions";
import { BackupError } from "@/lib/backup/service";
import { BackupFormatError } from "@/lib/backup/format";
import { DriveError } from "@/lib/backup/drive";
import { cancelRestore, confirmRestore, discardPreparedRecovery, prepareRestore, rescueFromRecovery, restoreSources } from "@/lib/backup/runtime";
import { prisma } from "@/lib/prisma";
import { failedAttemptGuard, rateLimitGuard, recordFailedAttempt, userIdentities } from "@/lib/rate-limit";

export async function GET() {
  const auth = await authorize("backupLocal", "read");
  if (auth.response) return auth.response;
  return NextResponse.json(await restoreSources());
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), backupId: z.string().max(100).optional(), driveFileId: z.string().max(200).optional(), file: z.string().max(500).optional(), passphrase: z.string().max(200).optional() }),
  z.object({ action: z.literal("confirm"), recoveryId: z.string().max(100), confirmation: z.string().max(300) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("rescue"), recoveryId: z.string().max(100) }),
  z.object({ action: z.literal("discard"), recoveryId: z.string().max(100) }),
]);

export async function POST(request: NextRequest) {
  const auth = await authorize("backupLocal", "write", { offlineCapable: true });
  if (auth.response) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;
  // Passphrases are only entered at prepare: failed prepares have a strict limit (passphrase guessing) and every
  // prepare a looser one (each copies a whole database). Confirm and rescue need a copy already prepared, so they get
  // the ordinary limit; cancel and discard only back out and are never limited, so an administrator can always clean up.
  const identities = await userIdentities(auth.user.id);
  if (body.action === "prepare") {
    const limited = (await failedAttemptGuard(prisma, "restoreFailed", identities)) ?? (await rateLimitGuard(prisma, "restorePrepare", identities));
    if (limited) return limited;
  } else if (body.action === "confirm" || body.action === "rescue") {
    const limited = await rateLimitGuard(prisma, "sensitive", identities);
    if (limited) return limited;
  }
  try {
    if (body.action === "prepare") {
      try {
        return NextResponse.json({ plan: await prepareRestore(body, auth.user.id) }, { status: 201 });
      } catch (e) {
        await recordFailedAttempt(prisma, "restoreFailed", identities);
        throw e;
      }
    }
    if (body.action === "confirm") return NextResponse.json(await confirmRestore(body, auth.user.id));
    if (body.action === "cancel") return NextResponse.json({ cancelled: await cancelRestore(auth.user.id) });
    if (body.action === "rescue") return NextResponse.json(await rescueFromRecovery(body.recoveryId, auth.user.id));
    discardPreparedRecovery(body.recoveryId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const known = e instanceof BackupError || e instanceof BackupFormatError || e instanceof DriveError;
    return NextResponse.json({ error: (e as Error).message }, { status: known ? 400 : 500 });
  }
}
