// src/app/api/sync/devices/[id]/route.ts - Revoke a computer's sync access (its local data is never erased remotely),
// or move a failed office server's computers to another office server or straight to the cloud (Report 23 §4.3).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { moveDevices, revokeDevice } from "@/lib/sync/server";
import { userRateLimitGuard } from "@/lib/rate-limit";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("sync", "delete");
  if (auth.response) return auth.response;
  const limited = await userRateLimitGuard(prisma, request, "sensitive", auth.user.id);
  if (limited) return limited;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  if (body?.action === "move-devices") {
    const toHubId = typeof body.toHubId === "string" && body.toHubId ? body.toHubId : null;
    try {
      const r = await moveDevices(prisma, id, toHubId);
      await prisma.auditLog.create({ data: { entity: "Device", entityId: id, action: "MOVE_DEVICES", userId: auth.user.id, after: JSON.stringify({ toHubId, ...r }) } });
      return NextResponse.json(r);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  if (body?.action !== "revoke") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const revoked = await revokeDevice(prisma, id);
  await prisma.auditLog.create({ data: { entity: "Device", entityId: id, action: "REVOKE", userId: auth.user.id, reason: typeof body.reason === "string" ? body.reason : null } });
  return NextResponse.json({ device: { id: revoked.id, status: revoked.status } });
}
