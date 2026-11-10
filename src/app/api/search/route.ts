// src/app/api/search/route.ts - Global search (header search, Ctrl+K). Only the groups the user may read are searched.
//   GET /api/search?q=ali              -> the first few of every group, and the best match
//   GET /api/search?q=ali&group=sales&skip=4 -> the next page of one group ("Show more")
//   GET /api/search?group=customers&browse=1  -> one group from the top, nothing typed yet
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { GROUP_RESOURCE, SEARCH_GROUPS, searchAll, searchGroup, type SearchGroupId } from "@/lib/search";

export async function GET(request: Request) {
  const auth = await getAuthSession();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const group = sp.get("group") as SearchGroupId | null;
  // `browse=1` with one group lists it from the top before anything is typed (the ledger pickers)
  const browse = !!group && sp.get("browse") === "1";
  if (q.length < 2 && !browse) return NextResponse.json({ q, groups: [], best: null });

  const allowed = SEARCH_GROUPS.filter((g) => can(auth.user.role, GROUP_RESOURCE[g], "read"));
  try {
    if (group) {
      if (!allowed.includes(group)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
      const skip = Math.max(0, Math.min(500, Number(sp.get("skip")) || 0));
      return NextResponse.json({ q, ...(await searchGroup(prisma, group, q, skip, 8)) });
    }
    return NextResponse.json({ q, ...(await searchAll(prisma, q, allowed, 4)) });
  } catch (e) {
    console.error("Search failed", e);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
