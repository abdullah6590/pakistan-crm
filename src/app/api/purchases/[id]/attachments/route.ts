// src/app/api/purchases/[id]/attachments/route.ts - Supplier documents of a purchase bill (Report 30 §2): list, and add
// one (multipart field "file", optional "note").
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError } from "@/lib/accounting/server";
import { addAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/purchases/attachments";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("purchases", "read");
  if (auth.response) return auth.response;
  const { id } = await params;
  const attachments = await prisma.documentAttachment.findMany({
    where: { documentId: id, removedAt: null },
    select: { id: true, fileName: true, mimeType: true, size: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ attachments });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize("purchases", "write");
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "The file is larger than 5 MB" }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    const note = form.get("note");
    const attachment = await addAttachment(prisma, auth.user.id, id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, typeof note === "string" ? note : null);
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return accountingError(error);
  }
}
