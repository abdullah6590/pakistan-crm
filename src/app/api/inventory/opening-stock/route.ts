// src/app/api/inventory/opening-stock/route.ts - Items whose stock is not in Books yet, and entering their opening stock
// once, at a cost the owner confirms (owner instruction 2026-10-26). A verified copy of the database is taken first.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { accountingError, accountingReady, serialize } from "@/lib/accounting/server";
import { openingStockCandidates, postOpeningStock } from "@/lib/accounting/opening-stock";
import { dbFileFromUrl, safetySnapshot } from "@/lib/backup/service";
import { currentTenantId } from "@/lib/tenancy/context";
import { defaultTenant, getTenant } from "@/lib/tenancy/registry";
import { isAuthority } from "@/lib/sync/local";

const amount = z.union([z.number(), z.string().trim().min(1)]);
const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  remarks: z.string().max(500).optional(),
  requestId: z.string().min(8).max(100).optional(),
  confirmed: z.literal(true, { message: "Tick that you have checked the quantities and costs" }),
  lines: z.array(z.object({
    componentId: z.string().min(1), quantity: amount, unit: z.string().min(1).max(20).optional(),
    loose: amount.optional(), unitCost: amount,
  })).min(1, "Choose at least one item").max(500),
});

export async function GET() {
  const auth = await authorize("inventory", "read");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    return NextResponse.json(serialize({ items: await openingStockCandidates(prisma), canPost: auth.user.role === "ADMIN" }));
  } catch (error) {
    return accountingError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize("inventory", "write");
  if (auth.response) return auth.response;
  if (auth.user.role !== "ADMIN") return NextResponse.json({ error: "Only an administrator can enter opening stock" }, { status: 403 });
  if (!isAuthority()) return NextResponse.json({ error: "Enter opening stock on the main computer; it reaches this one by sync" }, { status: 409 });
  try {
    const input = bodySchema.parse(await request.json());
    await accountingReady();
    const tenant = (await getTenant(await currentTenantId())) ?? defaultTenant();
    // A verified copy first, so the entry can always be undone by restoring it
    const backup = await safetySnapshot({ db: prisma, dbFile: dbFileFromUrl(tenant.dbUrl), dbKey: process.env.CRM_DB_ENCRYPTION_KEY || undefined }, "before-opening-stock");
    const result = await postOpeningStock(prisma, { id: auth.user.id, role: auth.user.role }, input);
    return NextResponse.json(serialize({ ...result, backup }), { status: result.repeated ? 200 : 201 });
  } catch (error) {
    return accountingError(error);
  }
}
