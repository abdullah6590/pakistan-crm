// src/app/api/sales/step/route.ts - The << < > >> buttons of the sale screen: the bill before or after another one.
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { STEP_TYPES, stepBill, type StepDirection, type StepType } from "@/lib/sales/step";

const DIRECTIONS: StepDirection[] = ["first", "prev", "next", "last"];

export async function GET(request: NextRequest) {
  const auth = await authorize("sales", "read");
  if (auth.response) return auth.response;
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") as StepType;
  const dir = sp.get("dir") as StepDirection;
  if (!STEP_TYPES.includes(type) || !DIRECTIONS.includes(dir)) return NextResponse.json({ error: "Unknown bill type or direction" }, { status: 400 });
  const bill = await stepBill(prisma, type, dir, sp.get("from"));
  return NextResponse.json({ bill });
}
