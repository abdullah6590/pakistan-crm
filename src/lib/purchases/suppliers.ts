// src/lib/purchases/suppliers.ts - Supplier records (Report 30 §1): create with a duplicate check, edit with audit history,
// archive instead of delete. A supplier's money (bills, payments, balance) lives in Books on their own account, so
// archiving never touches it; an archived supplier only stops getting new bills.
import type { Prisma, PrismaClient, Supplier } from "@prisma/client";
import { PostingError } from "@/lib/accounting/posting";

export const SUPPLIER_FIELDS = ["name", "company", "contactPerson", "email", "phone", "address", "city", "country", "taxNumber", "notes", "customFields"] as const;
export type SupplierFields = Partial<Record<(typeof SUPPLIER_FIELDS)[number], string | null>>;

/** "M/s Ali Paper Mills (Pvt.) Ltd." and "ali paper mills" are the same name for duplicate checks. */
export function normalName(name: string) {
  return name.toLowerCase().replace(/\b(m\/s|messrs|pvt|private|ltd|limited|co|company|and|&)\b/g, " ").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim().replace(/\s+/g, " ");
}
/** Last 10 digits of a phone number: 0300-1234567, +92 300 1234567 and 03001234567 match. */
export function normalPhone(phone: string | null | undefined) {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}

/** Suppliers that look like the same business: same name (ignoring "M/s", "Ltd", punctuation) or same phone number. */
export async function possibleDuplicates(db: PrismaClient | Prisma.TransactionClient, data: { name?: string | null; phone?: string | null }, exceptId?: string) {
  const name = data.name ? normalName(data.name) : "";
  const phone = normalPhone(data.phone);
  if (!name && !phone) return [];
  const all = await db.supplier.findMany({ where: exceptId ? { id: { not: exceptId } } : {}, select: { id: true, name: true, phone: true, isActive: true } });
  return all.filter((s) => (name && normalName(s.name) === name) || (phone && normalPhone(s.phone) === phone))
    .map((s) => ({ ...s, match: name && normalName(s.name) === name ? "name" : "phone" }));
}

function clean(input: SupplierFields): SupplierFields {
  const out: SupplierFields = {};
  for (const k of SUPPLIER_FIELDS) {
    if (!(k in input)) continue;
    const v = input[k];
    out[k] = typeof v === "string" ? (v.trim() || null) : null;
  }
  if (out.customFields) {
    try {
      const list = JSON.parse(out.customFields) as unknown;
      if (!Array.isArray(list) || list.some((f) => typeof f?.label !== "string" || typeof f?.value !== "string")) throw new Error();
      out.customFields = JSON.stringify(list.filter((f: { label: string; value: string }) => f.label.trim()).map((f: { label: string; value: string }) => ({ label: f.label.trim().slice(0, 60), value: f.value.trim().slice(0, 500) })));
    } catch {
      throw new PostingError("Extra details must be a list of label and value pairs");
    }
  }
  return out;
}

async function auditSupplier(tx: Prisma.TransactionClient, supplierId: string, action: string, userId: string, extra: { reason?: string; before?: unknown; after?: unknown }) {
  await tx.auditLog.create({
    data: {
      entity: "Supplier", entityId: supplierId, action, userId, reason: extra.reason ?? null,
      before: extra.before === undefined ? null : JSON.stringify(extra.before), after: extra.after === undefined ? null : JSON.stringify(extra.after),
    },
  });
}

/**
 * Add a supplier. A likely duplicate (same name or phone) is refused with the matches listed, unless the person
 * confirms it is a different business and says why; that confirmation is kept in the audit history.
 */
export async function createSupplier(db: PrismaClient, userId: string, input: SupplierFields & { confirmNotDuplicate?: string }) {
  const data = clean(input);
  if (!data.name) throw new PostingError("Enter the supplier's name");
  return db.$transaction(async (tx) => {
    const dups = await possibleDuplicates(tx, data);
    const why = input.confirmNotDuplicate?.trim();
    if (dups.length && (!why || why.length < 5)) {
      const err = new PostingError(`This looks like an existing supplier: ${dups.map((d) => `${d.name}${d.isActive ? "" : " (archived)"}`).join(", ")}`, 409);
      err.details = { duplicates: dups };
      throw err;
    }
    const supplier = await tx.supplier.create({ data: { ...(data as Prisma.SupplierCreateInput), name: data.name!, country: data.country ?? "Pakistan" } });
    await auditSupplier(tx, supplier.id, "CREATE", userId, { after: data, reason: dups.length ? `Not a duplicate of ${dups.map((d) => d.name).join(", ")}: ${why}` : undefined });
    return supplier;
  });
}

/** Change a supplier's details; the old and new values are kept in the audit history. Their Books account follows. */
export async function updateSupplier(db: PrismaClient, userId: string, id: string, input: SupplierFields & { confirmNotDuplicate?: string }) {
  const data = clean(input);
  if ("name" in data && !data.name) throw new PostingError("Enter the supplier's name");
  return db.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw new PostingError("Supplier not found", 404);
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v));
    if (!Object.keys(changed).length) return before;
    if ("name" in changed || "phone" in changed) {
      const dups = await possibleDuplicates(tx, { name: data.name ?? before.name, phone: data.phone ?? before.phone }, id);
      if (dups.length && (input.confirmNotDuplicate?.trim().length ?? 0) < 5) {
        const err = new PostingError(`This looks like an existing supplier: ${dups.map((d) => d.name).join(", ")}`, 409);
        err.details = { duplicates: dups };
        throw err;
      }
    }
    const supplier = await tx.supplier.update({ where: { id }, data: changed });
    const party = await tx.ledgerAccount.findUnique({ where: { supplierId: id } });
    if (party && ("name" in changed || "phone" in changed || "address" in changed)) {
      await tx.ledgerAccount.update({ where: { id: party.id }, data: { name: supplier.name, phone: supplier.phone, address: supplier.address } });
    }
    await auditSupplier(tx, id, "UPDATE", userId, {
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])), after: changed, reason: input.confirmNotDuplicate?.trim() || undefined,
    });
    return supplier;
  });
}

/** Archive (or bring back) a supplier. Their bills, payments and balance stay as they are. */
export async function setSupplierActive(db: PrismaClient, userId: string, id: string, active: boolean, reason: string) {
  if (!reason?.trim() || reason.trim().length < 3) throw new PostingError("Give a reason");
  return db.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw new PostingError("Supplier not found", 404);
    if (before.isActive === active) return before;
    const supplier = await tx.supplier.update({ where: { id }, data: { isActive: active } });
    await auditSupplier(tx, id, active ? "RESTORE" : "ARCHIVE", userId, { reason: reason.trim(), before: { isActive: before.isActive }, after: { isActive: active } });
    return supplier;
  });
}

/** A supplier's change history for the profile page. */
export async function supplierHistory(db: PrismaClient, supplier: Supplier) {
  const rows = await db.auditLog.findMany({ where: { entity: "Supplier", entityId: supplier.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, by: people.get(r.userId) ?? "Unknown user", reason: r.reason, before: r.before, after: r.after }));
}
