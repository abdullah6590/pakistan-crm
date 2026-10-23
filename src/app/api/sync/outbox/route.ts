// src/app/api/sync/outbox/route.ts - Entries waiting on this computer: list, withdraw, or act on a pending entry.
import { NextRequest, NextResponse } from "next/server";
import { authorize, can, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { localDevice } from "@/lib/sync/local";
import { cancelPending, submitCommand, OutboxError } from "@/lib/sync/outbox";

export async function GET() {
  const auth = await authorize("sync", "read");
  if (auth.response) return auth.response;
  const entries = await prisma.outboxCommand.findMany({ orderBy: { seq: "desc" }, take: 500 });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const auth = await authorize("sync", "read");
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "withdraw") {
      const row = await prisma.outboxCommand.findUnique({ where: { id: String(body.id) } });
      if (!row) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      // Only the person who entered it, or an administrator, may withdraw an entry
      if (row.createdById !== auth.user.id && auth.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      return NextResponse.json({ withdrawn: await cancelPending(prisma, row.id, String(body.reason ?? "")) });
    }
    if (body.action === "approve" || body.action === "reject" || body.action === "cancel") {
      // Act on an entry still pending on this computer (e.g. approve an offline stock issue)
      const parent = await prisma.outboxCommand.findUnique({ where: { id: String(body.id) } });
      if (!parent || parent.type !== "CREATE_DOCUMENT") return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      const docType = JSON.parse(parent.payload).docType as string;
      const allowed = body.action === "cancel" ? can(auth.user.role, DOCUMENT_RESOURCE[docType], "delete") : can(auth.user.role, "stockApproval", "write");
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const entry = await submitCommand(prisma, localDevice(), {
        type: "DOCUMENT_ACTION", actorUserId: auth.user.id, action: body.action, target: { commandRef: parent.id },
        reason: body.reason, overrideReason: body.overrideReason,
      });
      return NextResponse.json({ entry }, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof OutboxError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
