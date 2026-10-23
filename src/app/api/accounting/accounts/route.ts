// src/app/api/accounting/accounts/route.ts - Chart of accounts: parties, cash/bank and general-ledger accounts.
import { NextRequest, NextResponse } from "next/server";
import { authorize, can } from "@/lib/permissions";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ledgerAccountSchema } from "@/lib/accounting/schemas";
import { accountingError, accountingReady } from "@/lib/accounting/server";
import { accountBalance } from "@/lib/accounting/posting";
import { toPlain } from "@/lib/domain/decimal";

// Anyone who enters documents needs to pick parties and cash accounts; balances are for ledger readers only
const PICKER_RESOURCES = ["ledgers", "sales", "cashSales", "purchases", "press", "stockIssues", "vouchers", "transfers"];

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!PICKER_RESOURCES.some((r) => can(user.role, r, "read"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await accountingReady();

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const subType = searchParams.get("subType");
  const withBalance = searchParams.get("balances") === "true" && can(user.role, "ledgers", "read");
  const accounts = await prisma.ledgerAccount.findMany({
    where: { ...(kind ? { kind } : {}), ...(subType ? { subType } : {}), ...(searchParams.get("all") === "true" ? {} : { isActive: true }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  const rows = [];
  for (const a of accounts) {
    rows.push({ ...a, balance: withBalance ? toPlain(await accountBalance(prisma, a.id)) : undefined });
  }
  return NextResponse.json({ accounts: rows });
}

const CODE_PREFIX: Record<string, string> = { PARTY: "P", CASH_BANK: "B", GL: "G" };

export async function POST(request: NextRequest) {
  const auth = await authorize("ledgers", "write");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const data = ledgerAccountSchema.parse(await request.json());
    if (data.kind === "CASH_BANK" && !["CASH", "BANK"].includes(data.subType ?? "")) {
      return NextResponse.json({ error: "A cash/bank account must be CASH or BANK" }, { status: 400 });
    }
    const account = await prisma.$transaction(async (tx) => {
      const series = await tx.documentSeries.upsert({
        where: { series: `ACCOUNT-${data.kind}` },
        create: { series: `ACCOUNT-${data.kind}`, nextNumber: 2 },
        update: { nextNumber: { increment: 1 } },
      });
      const code = `${CODE_PREFIX[data.kind]}-${String(series.nextNumber - 1).padStart(4, "0")}`;
      const created = await tx.ledgerAccount.create({ data: { ...data, code } });
      await tx.auditLog.create({ data: { entity: "LedgerAccount", entityId: created.id, action: "CREATE", userId: auth.user.id, after: JSON.stringify(data) } });
      return created;
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return accountingError(error);
  }
}
