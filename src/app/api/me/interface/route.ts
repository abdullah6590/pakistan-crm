// src/app/api/me/interface/route.ts - The signed-in user's own interface: modern (sidebar) or classic (menu bar).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";
import { interfaceKey, parseLayout, UI_LAYOUTS, type UiLayout } from "@/lib/interface-pref";

export async function GET() {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const row = await prisma.setting.findUnique({ where: { key: interfaceKey(auth.user.id) } });
  return NextResponse.json({ layout: parseLayout(row?.value) });
}

export async function PUT(request: Request) {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!UI_LAYOUTS.includes(body?.layout)) return NextResponse.json({ error: "Choose modern or classic" }, { status: 400 });
  const layout = body.layout as UiLayout;
  const key = interfaceKey(auth.user.id);
  await prisma.setting.upsert({ where: { key }, create: { key, value: layout }, update: { value: layout } });
  return NextResponse.json({ layout });
}
