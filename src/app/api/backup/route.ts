// src/app/api/backup/route.ts - Database Backup & Restore API
// ADMIN-only (audit SEC-02/SEC-03). Exports never contain password hashes or sessions.
// Restores never touch user accounts, take a safety snapshot first and run in one transaction.
import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const BACKUP_VERSION = "3.0";
const ACCEPTED_VERSIONS = ["2.0", "3.0"];

async function buildExport(exportedBy: string) {
  const [
    users, suppliers, customers, components, componentCategories,
    sales, saleItems, purchases, purchaseItems,
    finance, partners, invoices, projects, teamMembers,
    projectComponents, inventoryHistory, notifications, settings,
    supplierPayments, customerPayments, cashSales,
    financialAccounts, accountTransfers, expenditures,
  ] = await Promise.all([
    // Password hashes are deliberately excluded
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, image: true, phone: true, address: true, isActive: true, createdAt: true, updatedAt: true },
    }),
    prisma.supplier.findMany(),
    prisma.customer.findMany(),
    prisma.component.findMany(),
    prisma.componentCategory.findMany(),
    prisma.sale.findMany(),
    prisma.saleItem.findMany(),
    prisma.purchase.findMany(),
    prisma.purchaseItem.findMany(),
    prisma.finance.findMany(),
    prisma.partner.findMany(),
    prisma.invoice.findMany(),
    prisma.project.findMany(),
    prisma.teamMember.findMany(),
    prisma.projectComponent.findMany(),
    prisma.inventoryHistory.findMany(),
    prisma.notification.findMany(),
    prisma.setting.findMany(),
    prisma.supplierPayment.findMany(),
    prisma.customerPayment.findMany(),
    prisma.cashSale.findMany(),
    prisma.financialAccount.findMany(),
    prisma.accountTransfer.findMany(),
    prisma.expenditure.findMany(),
  ]);

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    data: {
      users, suppliers, customers, components, componentCategories,
      sales, saleItems, purchases, purchaseItems,
      finance, partners, invoices, projects, teamMembers,
      projectComponents, inventoryHistory, notifications, settings,
      supplierPayments, customerPayments, cashSales,
      financialAccounts, accountTransfers, expenditures,
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorize("backup", "read");
  if (auth.response) return auth.response;
  const user = auth.user;

  const backup = await buildExport(user.id);
  console.info(`[audit] backup exported by ${user.id} at ${backup.exportedAt}`);

  const json = JSON.stringify(backup, null, 2);
  const buffer = Buffer.from(json, "utf-8");

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="crm-backup-${new Date().toISOString().split("T")[0]}.json"`,
    },
  });
}

const RESTORABLE_TABLES = [
  "componentCategories", "suppliers", "customers", "components", "partners", "financialAccounts",
  "settings", "projects", "sales", "purchases", "saleItems", "purchaseItems", "finance",
  "supplierPayments", "customerPayments", "cashSales", "accountTransfers", "expenditures",
  "invoices", "notifications",
];

function validateBackup(body: any): string | null {
  if (!body || typeof body !== "object") return "Invalid backup file format";
  if (!ACCEPTED_VERSIONS.includes(body.version)) return `Unsupported backup version: ${String(body.version)}`;
  if (!body.data || typeof body.data !== "object") return "Backup file has no data section";
  for (const key of RESTORABLE_TABLES) {
    const value = body.data[key];
    if (value !== undefined && !Array.isArray(value)) return `Backup section "${key}" is not a list`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await authorize("backup", "write");
  if (auth.response) return auth.response;
  const user = auth.user;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid backup file format" }, { status: 400 });
  }

  const invalid = validateBackup(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const d = body.data;

  // Safety snapshot of the current data before anything is deleted
  let snapshotFile: string;
  try {
    const dir = path.join(/* turbopackIgnore: true */ process.cwd(), "backups");
    await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
    snapshotFile = path.join(/* turbopackIgnore: true */ dir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(/* turbopackIgnore: true */ snapshotFile, JSON.stringify(await buildExport(user.id)), "utf-8");
  } catch (error) {
    console.error("[backup] pre-restore snapshot failed:", error);
    return NextResponse.json({ error: "Could not create a safety snapshot; restore cancelled." }, { status: 500 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Delete existing business data in reverse dependency order. Users, sessions and accounts are kept.
      await tx.inventoryHistory.deleteMany();
      await tx.saleItem.deleteMany();
      await tx.purchaseItem.deleteMany();
      await tx.projectComponent.deleteMany();
      await tx.teamMember.deleteMany();
      await tx.attachment.deleteMany();
      await tx.supplierPayment.deleteMany();
      await tx.customerPayment.deleteMany();
      await tx.cashSale.deleteMany();
      await tx.accountTransfer.deleteMany();
      await tx.expenditure.deleteMany();
      await tx.sale.deleteMany();
      await tx.purchase.deleteMany();
      await tx.finance.deleteMany();
      await tx.notification.deleteMany();
      await tx.invoice.deleteMany();
      await tx.project.deleteMany();
      await tx.component.deleteMany();
      await tx.componentCategory.deleteMany();
      await tx.financialAccount.deleteMany();
      await tx.partner.deleteMany();
      await tx.customer.deleteMany();
      await tx.supplier.deleteMany();
      await tx.setting.deleteMany();

      // Restore in dependency order. Records must reference existing users, otherwise the
      // whole restore fails and is rolled back.
      for (const c of d.componentCategories ?? []) {
        await tx.componentCategory.create({ data: { ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) } });
      }
      for (const s of d.suppliers ?? []) {
        await tx.supplier.create({ data: { ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) } });
      }
      for (const c of d.customers ?? []) {
        await tx.customer.create({ data: { ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) } });
      }
      for (const c of d.components ?? []) {
        await tx.component.create({
          data: {
            ...c,
            lastPurchasedAt: c.lastPurchasedAt ? new Date(c.lastPurchasedAt) : null,
            lastSoldAt: c.lastSoldAt ? new Date(c.lastSoldAt) : null,
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
          },
        });
      }
      for (const p of d.partners ?? []) {
        await tx.partner.create({ data: { ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) } });
      }
      for (const a of d.financialAccounts ?? []) {
        await tx.financialAccount.create({ data: { ...a, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) } });
      }
      for (const s of d.settings ?? []) {
        await tx.setting.create({ data: s });
      }
      for (const p of d.projects ?? []) {
        await tx.project.create({
          data: {
            ...p,
            startDate: new Date(p.startDate),
            deadline: p.deadline ? new Date(p.deadline) : null,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          },
        });
      }
      for (const s of d.sales ?? []) {
        await tx.sale.create({ data: { ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) } });
      }
      for (const p of d.purchases ?? []) {
        await tx.purchase.create({ data: { ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) } });
      }
      for (const si of d.saleItems ?? []) {
        await tx.saleItem.create({ data: { ...si, createdAt: new Date(si.createdAt) } });
      }
      for (const pi of d.purchaseItems ?? []) {
        await tx.purchaseItem.create({ data: { ...pi, createdAt: new Date(pi.createdAt) } });
      }
      for (const f of d.finance ?? []) {
        await tx.finance.create({ data: { ...f, date: new Date(f.date), createdAt: new Date(f.createdAt), updatedAt: new Date(f.updatedAt) } });
      }
      for (const sp of d.supplierPayments ?? []) {
        await tx.supplierPayment.create({ data: { ...sp, date: new Date(sp.date), createdAt: new Date(sp.createdAt) } });
      }
      for (const cp of d.customerPayments ?? []) {
        await tx.customerPayment.create({ data: { ...cp, date: new Date(cp.date), createdAt: new Date(cp.createdAt) } });
      }
      for (const cs of d.cashSales ?? []) {
        await tx.cashSale.create({ data: { ...cs, date: new Date(cs.date), createdAt: new Date(cs.createdAt) } });
      }
      for (const at of d.accountTransfers ?? []) {
        await tx.accountTransfer.create({ data: { ...at, date: new Date(at.date), createdAt: new Date(at.createdAt) } });
      }
      for (const e of d.expenditures ?? []) {
        await tx.expenditure.create({ data: { ...e, date: new Date(e.date), createdAt: new Date(e.createdAt) } });
      }
      for (const inv of d.invoices ?? []) {
        await tx.invoice.create({
          data: {
            ...inv,
            dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
            createdAt: new Date(inv.createdAt),
            updatedAt: new Date(inv.updatedAt),
          },
        });
      }
      for (const n of d.notifications ?? []) {
        await tx.notification.create({ data: { ...n, createdAt: new Date(n.createdAt) } });
      }
    }, { timeout: 300_000, maxWait: 30_000 });

    console.info(`[audit] backup restored by ${user.id}; snapshot ${snapshotFile}`);
    return NextResponse.json({
      success: true,
      message: "Database restored successfully. User accounts were not changed.",
      snapshot: path.basename(snapshotFile),
      stats: {
        suppliers: d.suppliers?.length || 0,
        customers: d.customers?.length || 0,
        components: d.components?.length || 0,
      },
    });
  } catch (error) {
    console.error("[backup] restore failed and was rolled back:", error);
    return NextResponse.json(
      { error: "Restore failed and was rolled back; no data was changed.", snapshot: path.basename(snapshotFile) },
      { status: 500 }
    );
  }
}
