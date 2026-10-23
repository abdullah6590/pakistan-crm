// src/app/api/accounting/documents/[id]/route.ts - Document detail (lines, journal, stock, history) and actions.
import { NextRequest, NextResponse } from "next/server";
import { authorize, DOCUMENT_RESOURCE } from "@/lib/permissions";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { documentActionSchema, DOCUMENT_SCHEMAS, DocumentType } from "@/lib/accounting/schemas";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { approveDocument, rejectDocument, cancelDocument, amendDocument } from "@/lib/accounting/posting";
import { isAuthority, localDevice, OFFLINE_ONLY_MESSAGE } from "@/lib/sync/local";
import { submitCommand, OutboxError } from "@/lib/sync/outbox";

async function findType(id: string) {
  return prisma.accountingDocument.findUnique({ where: { id }, select: { type: true } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAuthUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const found = await findType(id);
  if (!found) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const auth = await authorize(DOCUMENT_RESOURCE[found.type], "read");
  if (auth.response) return auth.response;

  const document = await prisma.accountingDocument.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: "asc" }, include: { component: { select: { id: true, name: true, sku: true } } } },
      partyAccount: true,
      cashAccount: true,
      journalEntries: { include: { lines: { include: { account: { select: { code: true, name: true, kind: true } } } } }, orderBy: { createdAt: "asc" } },
      stockMovements: { include: { location: { select: { code: true, name: true } } }, orderBy: { createdAt: "asc" } },
      supersedes: { select: { id: true, docNo: true } },
      supersededBy: { select: { id: true, docNo: true } },
    },
  });
  const history = await prisma.auditLog.findMany({ where: { entity: "AccountingDocument", entityId: id }, orderBy: { createdAt: "asc" } });
  const userIds = [...new Set(history.map((h) => h.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  return NextResponse.json(serialize({ document, history, users }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAuthUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const found = await findType(id);
  if (!found) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  try {
    const body = documentActionSchema.parse(await request.json().catch(() => ({})));
    if (body.action === "printed" && !isAuthority()) {
      // The reprint counter lives on the server; a local print is not counted until online
      return NextResponse.json({ document: null, message: "Print counted only on the main server" });
    }
    if (body.action === "printed") {
      // Reprint marker (Report 14): anyone who may read the document may print it
      const reader = await authorize(DOCUMENT_RESOURCE[found.type], "read");
      if (reader.response) return reader.response;
      const document = await prisma.accountingDocument.update({ where: { id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
      return NextResponse.json(serialize({ document }));
    }
    // Approval is an administrator decision; cancel and amend need delete rights on the document's module
    const auth = body.action === "approve" || body.action === "reject"
      ? await authorize("stockApproval", "write", { offlineCapable: true })
      : await authorize(DOCUMENT_RESOURCE[found.type], "delete", { offlineCapable: true });
    if (auth.response) return auth.response;
    const actor = { id: auth.user.id, role: auth.user.role };
    await accountingReady();
    if (!isAuthority()) {
      if (body.action === "amend") return NextResponse.json({ error: OFFLINE_ONLY_MESSAGE }, { status: 503 });
      const current = await prisma.accountingDocument.findUniqueOrThrow({ where: { id }, select: { status: true } });
      // The expected status turns a change made elsewhere meanwhile into a reviewable conflict (Report 21 §3.4)
      const entry = await submitCommand(prisma, localDevice(), {
        type: "DOCUMENT_ACTION", actorUserId: actor.id, action: body.action, target: { id }, expect: { status: current.status },
        reason: "reason" in body ? body.reason : undefined, overrideReason: "overrideReason" in body ? body.overrideReason : undefined,
      });
      return NextResponse.json(serialize({ pending: true, entry }), { status: 202 });
    }
    const document =
      body.action === "approve" ? await approveDocument(prisma, actor, id, { overrideReason: body.overrideReason })
      : body.action === "reject" ? await rejectDocument(prisma, actor, id, body.reason)
      : body.action === "cancel" ? await cancelDocument(prisma, actor, id, body.reason)
      : await amendDocument(prisma, actor, id, DOCUMENT_SCHEMAS[found.type as DocumentType]?.parse(body.input) ?? body.input, body.reason);
    return NextResponse.json(serialize({ document }));
  } catch (error) {
    if (error instanceof OutboxError) return NextResponse.json({ error: error.message }, { status: error.status });
    return accountingError(error);
  }
}
