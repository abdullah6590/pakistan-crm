// src/app/api/sales/step/route.ts - The << < > >> buttons of the sale screen: the bill before or after another one.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { STEP_TYPES, findBill, stepBill, type StepDirection, type StepType } from "@/lib/sales/step";

const DIRECTIONS: StepDirection[] = ["first", "prev", "next", "last"];

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") as StepType;
  // Supplier invoices need the purchases permission (P-3: administrators and accountants), sale bills the sales one
  const auth = await authorize(type === "PURCHASE_INVOICE" ? "purchases" : "sales", "read");
  if (auth.response) return auth.response;
  // Find by number (old Find button)
  const number = sp.get("number");
  if (number !== null) {
    if (!STEP_TYPES.includes(type) || !/^\d{1,9}$/.test(number)) return NextResponse.json({ error: "Enter the bill number" }, { status: 400 });
    return NextResponse.json({ bill: await findBill(prisma, type, Number(number)) });
  }
  const dir = sp.get("dir") as StepDirection;
  if (!STEP_TYPES.includes(type) || !DIRECTIONS.includes(dir)) return NextResponse.json({ error: "Unknown bill type or direction" }, { status: 400 });
  const bill = await stepBill(prisma, type, dir, sp.get("from"));
  return NextResponse.json({ bill });
}
