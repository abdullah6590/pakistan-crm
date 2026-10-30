// src/lib/purchases/attachments.ts - Supplier documents kept with a purchase bill (Report 30 §2): a scanned bill, a
// delivery note. Only PDF and images, at most 5 MB, recognised by their content (not by the name or what the browser
// says). Stored in the business's own database, so backups include them and no other business can reach them.
// Removing one only marks it removed, with who, when and why.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PostingError } from "@/lib/accounting/posting";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** The file's real type from its first bytes; null when it is not an accepted kind. */
export function sniffType(bytes: Uint8Array): string | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export async function addAttachment(db: PrismaClient, userId: string, documentId: string, file: { name: string; bytes: Uint8Array }, note?: string | null) {
  const doc = await db.accountingDocument.findUnique({ where: { id: documentId }, select: { id: true, type: true, docNo: true } });
  if (!doc || !["PURCHASE_INVOICE", "PURCHASE_RETURN", "VOUCHER"].includes(doc.type)) throw new PostingError("Document not found", 404);
  if (file.bytes.length === 0) throw new PostingError("The file is empty");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new PostingError("The file is larger than 5 MB");
  const mimeType = sniffType(file.bytes);
  if (!mimeType) throw new PostingError("Attach a PDF or a picture (PNG, JPEG or WebP)");
  const fileName = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120) || "document";
  const sha256 = crypto.createHash("sha256").update(file.bytes).digest("hex");
  const same = await db.documentAttachment.findFirst({ where: { documentId, sha256, removedAt: null }, select: { id: true } });
  if (same) throw new PostingError("This file is already attached to the bill", 409);
  return db.$transaction(async (tx) => {
    const a = await tx.documentAttachment.create({
      data: { documentId, fileName, mimeType, size: file.bytes.length, sha256, data: Buffer.from(file.bytes), note: note?.trim() || null, uploadedById: userId },
      select: { id: true, fileName: true, mimeType: true, size: true, note: true, createdAt: true },
    });
    await tx.auditLog.create({ data: { entity: "AccountingDocument", entityId: documentId, action: "ATTACH", userId, after: JSON.stringify({ attachmentId: a.id, fileName, size: a.size, sha256 }) } });
    return a;
  });
}

export async function removeAttachment(db: PrismaClient, userId: string, attachmentId: string, reason: string) {
  if (!reason?.trim() || reason.trim().length < 3) throw new PostingError("Give a reason");
  return db.$transaction(async (tx) => {
    const a = await tx.documentAttachment.findUnique({ where: { id: attachmentId }, select: { id: true, documentId: true, fileName: true, removedAt: true } });
    if (!a || a.removedAt) throw new PostingError("Attachment not found", 404);
    await tx.documentAttachment.update({ where: { id: a.id }, data: { removedAt: new Date(), removedById: userId, removeReason: reason.trim() } });
    await tx.auditLog.create({ data: { entity: "AccountingDocument", entityId: a.documentId, action: "DETACH", userId, reason: reason.trim(), before: JSON.stringify({ attachmentId: a.id, fileName: a.fileName }) } });
  });
}
