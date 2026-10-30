// src/app/api/sync/devices/route.ts - Register and list the business's computers and office servers.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { registerDevice } from "@/lib/sync/server";
import { currentTenantId } from "@/lib/tenancy/context";
import { isAuthority, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";
import { userRateLimitGuard } from "@/lib/rate-limit";

export async function GET() {
  const auth = await authorize("sync", "delete");
  if (auth.response) return auth.response;
  const devices = await prisma.device.findMany({
    orderBy: { registeredAt: "asc" },
    select: { id: true, code: true, name: true, role: true, hubId: true, status: true, registeredAt: true, lastSeenAt: true, revokedAt: true },
  });
  return NextResponse.json({ devices });
}

const schema = z.object({ name: z.string().trim().min(1).max(60), role: z.enum(["DEVICE", "HUB"]), hubId: z.string().optional() });

export async function POST(request: NextRequest) {
  // Registration happens online at the main server; the secret is shown once, for the desktop installer to protect
  const auth = await authorize("sync", "write");
  if (auth.response) return auth.response;
  const limited = await userRateLimitGuard(prisma, request, "sensitive", auth.user.id);
  if (limited) return limited;
  if (!isAuthority()) return NextResponse.json({ error: OFFLINE_ONLY_MESSAGE }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Name the computer and choose DEVICE or HUB" }, { status: 400 });
  try {
    const { device, secret } = await registerDevice(prisma, { ...parsed.data, registeredById: auth.user.id });
    await prisma.auditLog.create({ data: { entity: "Device", entityId: device.id, action: "REGISTER", userId: auth.user.id, after: JSON.stringify({ code: device.code, name: device.name, role: device.role }) } });
    return NextResponse.json({ device: { id: device.id, code: device.code, name: device.name, role: device.role }, secret, tenantId: await currentTenantId() }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
