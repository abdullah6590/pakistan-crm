// src/app/api/me/shortcuts/route.ts - The signed-in user's own keyboard shortcuts (defaults where they changed nothing).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";
import { comboProblem, conflicts, defaultShortcuts, mergeShortcuts, normalizeCombo, SHORTCUT_ACTIONS, type ShortcutMap } from "@/lib/shortcuts";

const keyOf = (userId: string) => `shortcuts:${userId}`;

export async function GET() {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const row = await prisma.setting.findUnique({ where: { key: keyOf(auth.user.id) } });
  let saved: unknown = null;
  try { saved = row ? JSON.parse(row.value) : null; } catch { /* unreadable: the defaults apply */ }
  return NextResponse.json({ shortcuts: mergeShortcuts(saved), defaults: defaultShortcuts() });
}

/** Saves the whole set; an empty value turns a shortcut off. */
export async function PUT(request: Request) {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const input = body?.shortcuts;
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Send the shortcuts" }, { status: 400 });

  const next: ShortcutMap = defaultShortcuts();
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
    if (!action) return NextResponse.json({ error: `Unknown section: ${id}` }, { status: 400 });
    if (value === "" || value === null) { next[id] = ""; continue; }
    const combo = typeof value === "string" ? normalizeCombo(value) : null;
    if (!combo) return NextResponse.json({ error: `${action.label}: not a usable key` }, { status: 400 });
    const problem = comboProblem(combo);
    if (problem) return NextResponse.json({ error: `${action.label}: ${problem}` }, { status: 400 });
    next[id] = combo;
  }
  const clash = Object.entries(conflicts(next))[0];
  if (clash) {
    const names = clash[1].map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label ?? id).join(" and ");
    return NextResponse.json({ error: `${clash[0]} is given to both ${names}` }, { status: 400 });
  }
  await prisma.setting.upsert({ where: { key: keyOf(auth.user.id) }, create: { key: keyOf(auth.user.id), value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
  return NextResponse.json({ shortcuts: next });
}
