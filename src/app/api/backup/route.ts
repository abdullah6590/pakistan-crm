// src/app/api/backup/route.ts - Database Backup & Restore API
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Export all tables as JSON
  const [
    users, suppliers, customers, components, componentCategories,
    sales, saleItems, purchases, purchaseItems,
    finance, partners, invoices, projects, teamMembers,
    projectComponents, inventoryHistory, notifications, settings,
    supplierPayments, customerPayments, cashSales,
    financialAccounts, accountTransfers, expenditures,
  ] = await Promise.all([
    prisma.user.findMany(),
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

  const backup = {
    version: "2.0",
    exportedAt: new Date().toISOString(),
    exportedBy: user.id,
    data: {
      users, suppliers, customers, components, componentCategories,
      sales, saleItems, purchases, purchaseItems,
      finance, partners, invoices, projects, teamMembers,
      projectComponents, inventoryHistory, notifications, settings,
      supplierPayments, customerPayments, cashSales,
      financialAccounts, accountTransfers, expenditures,
    },
  };

  const json = JSON.stringify(backup, null, 2);
  const buffer = Buffer.from(json, "utf-8");

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="crm-backup-${new Date().toISOString().split("T")[0]}.json"`,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();

    if (!body.version || !body.data) {
      return NextResponse.json({ error: "Invalid backup file format" }, { status: 400 });
    }

    const d = body.data;

    // Delete all existing data in reverse dependency order
    await prisma.inventoryHistory.deleteMany();
    await prisma.saleItem.deleteMany();
    await prisma.purchaseItem.deleteMany();
    await prisma.projectComponent.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.supplierPayment.deleteMany();
    await prisma.customerPayment.deleteMany();
    await prisma.cashSale.deleteMany();
    await prisma.accountTransfer.deleteMany();
    await prisma.expenditure.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.purchase.deleteMany();
    await prisma.finance.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.project.deleteMany();
    await prisma.component.deleteMany();
    await prisma.componentCategory.deleteMany();
    await prisma.financialAccount.deleteMany();
    await prisma.partner.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    // Restore in dependency order
    if (d.users?.length) {
      for (const u of d.users) {
        await prisma.user.create({ data: { ...u, createdAt: new Date(u.createdAt), updatedAt: new Date(u.updatedAt) } });
      }
    }
    if (d.componentCategories?.length) {
      for (const c of d.componentCategories) {
        await prisma.componentCategory.create({ data: { ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) } });
      }
    }
    if (d.suppliers?.length) {
      for (const s of d.suppliers) {
        await prisma.supplier.create({ data: { ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) } });
      }
    }
    if (d.customers?.length) {
      for (const c of d.customers) {
        await prisma.customer.create({ data: { ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) } });
      }
    }
    if (d.components?.length) {
      for (const c of d.components) {
        await prisma.component.create({
          data: {
            ...c,
            lastPurchasedAt: c.lastPurchasedAt ? new Date(c.lastPurchasedAt) : null,
            lastSoldAt: c.lastSoldAt ? new Date(c.lastSoldAt) : null,
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
          },
        });
      }
    }
    if (d.partners?.length) {
      for (const p of d.partners) {
        await prisma.partner.create({ data: { ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) } });
      }
    }
    if (d.financialAccounts?.length) {
      for (const a of d.financialAccounts) {
        await prisma.financialAccount.create({ data: { ...a, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) } });
      }
    }
    if (d.settings?.length) {
      for (const s of d.settings) {
        await prisma.setting.create({ data: s });
      }
    }
    if (d.projects?.length) {
      for (const p of d.projects) {
        await prisma.project.create({
          data: {
            ...p,
            startDate: new Date(p.startDate),
            deadline: p.deadline ? new Date(p.deadline) : null,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          },
        });
      }
    }
    if (d.sales?.length) {
      for (const s of d.sales) {
        await prisma.sale.create({ data: { ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) } });
      }
    }
    if (d.purchases?.length) {
      for (const p of d.purchases) {
        await prisma.purchase.create({ data: { ...p, createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) } });
      }
    }
    if (d.saleItems?.length) {
      for (const si of d.saleItems) {
        await prisma.saleItem.create({ data: { ...si, createdAt: new Date(si.createdAt) } });
      }
    }
    if (d.purchaseItems?.length) {
      for (const pi of d.purchaseItems) {
        await prisma.purchaseItem.create({ data: { ...pi, createdAt: new Date(pi.createdAt) } });
      }
    }
    if (d.finance?.length) {
      for (const f of d.finance) {
        await prisma.finance.create({ data: { ...f, date: new Date(f.date), createdAt: new Date(f.createdAt), updatedAt: new Date(f.updatedAt) } });
      }
    }
    if (d.supplierPayments?.length) {
      for (const sp of d.supplierPayments) {
        await prisma.supplierPayment.create({ data: { ...sp, date: new Date(sp.date), createdAt: new Date(sp.createdAt) } });
      }
    }
    if (d.customerPayments?.length) {
      for (const cp of d.customerPayments) {
        await prisma.customerPayment.create({ data: { ...cp, date: new Date(cp.date), createdAt: new Date(cp.createdAt) } });
      }
    }
    if (d.cashSales?.length) {
      for (const cs of d.cashSales) {
        await prisma.cashSale.create({ data: { ...cs, date: new Date(cs.date), createdAt: new Date(cs.createdAt) } });
      }
    }
    if (d.accountTransfers?.length) {
      for (const at of d.accountTransfers) {
        await prisma.accountTransfer.create({ data: { ...at, date: new Date(at.date), createdAt: new Date(at.createdAt) } });
      }
    }
    if (d.expenditures?.length) {
      for (const e of d.expenditures) {
        await prisma.expenditure.create({ data: { ...e, date: new Date(e.date), createdAt: new Date(e.createdAt) } });
      }
    }
    if (d.invoices?.length) {
      for (const inv of d.invoices) {
        await prisma.invoice.create({
          data: {
            ...inv,
            dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
            createdAt: new Date(inv.createdAt),
            updatedAt: new Date(inv.updatedAt),
          },
        });
      }
    }
    if (d.notifications?.length) {
      for (const n of d.notifications) {
        await prisma.notification.create({ data: { ...n, createdAt: new Date(n.createdAt) } });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Database restored successfully",
      stats: {
        users: d.users?.length || 0,
        suppliers: d.suppliers?.length || 0,
        customers: d.customers?.length || 0,
        components: d.components?.length || 0,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: `Restore failed: ${error.message}` }, { status: 500 });
  }
}
