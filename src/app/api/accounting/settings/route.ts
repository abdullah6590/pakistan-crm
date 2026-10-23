// src/app/api/accounting/settings/route.ts - Accounting policies (negative stock, stock issue approval, default accounts).
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SETTING_DEFAULTS, SettingKey, getSetting, setSetting } from "@/lib/accounting/setup";
import { accountingError, accountingReady } from "@/lib/accounting/server";

export async function GET() {
  const auth = await authorize("accountingSettings", "read");
  if (auth.response) return auth.response;
  await accountingReady();
  const settings: Record<string, string> = {};
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) settings[key] = String(await getSetting(prisma, key));
  return NextResponse.json({ settings, defaults: SETTING_DEFAULTS });
}

export async function PUT(request: NextRequest) {
  const auth = await authorize("accountingSettings", "write");
  if (auth.response) return auth.response;
  try {
    await accountingReady();
    const body = (await request.json()) as Record<string, unknown>;
    const keys = Object.keys(body).filter((k): k is SettingKey => k in SETTING_DEFAULTS);
    if (!keys.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      for (const key of keys) await setSetting(tx, key, String(body[key]), auth.user.id);
    });
    return NextResponse.json({ updated: keys });
  } catch (error) {
    if (error instanceof Error && !("code" in error)) return NextResponse.json({ error: error.message }, { status: 400 });
    return accountingError(error);
  }
}
