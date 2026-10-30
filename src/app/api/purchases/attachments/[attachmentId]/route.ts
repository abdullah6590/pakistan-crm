// src/app/api/purchases/attachments/[attachmentId]/route.ts - Open a supplier document, or mark it removed (with a reason).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError } from "@/lib/accounting/server";
import { removeAttachment } from "@/lib/purchases/attachments";
import { cancelSchema } from "@/lib/purchases/schemas";

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const auth = await authorize("purchases", "read");
  if (auth.response) return auth.response;
  const { attachmentId } = await params;
  const a = await prisma.documentAttachment.findUnique({ where: { id: attachmentId } });
  if (!a || a.removedAt) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const inline = request.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(a.data), {
    headers: {
      // The type was checked from the file's content when it was added; the browser must not guess another one
      "Content-Type": a.mimeType, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${a.fileName.replace(/"/g, "")}"`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const auth = await authorize("purchases", "write");
  if (auth.response) return auth.response;
  const { attachmentId } = await params;
  try {
    const { reason } = cancelSchema.parse(await request.json().catch(() => ({})));
    await removeAttachment(prisma, auth.user.id, attachmentId, reason);
    return NextResponse.json({ success: true });
  } catch (error) {
    return accountingError(error);
  }
}
