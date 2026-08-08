import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { name, description, color } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Check if category already exists
    const existing = await prisma.componentCategory.findUnique({
      where: { name }
    });

    if (existing) {
      return NextResponse.json({ error: "Category with this name already exists" }, { status: 400 });
    }

    const category = await prisma.componentCategory.create({
      data: {
        name,
        description: description || null,
        color: color || "#6366F1",
      },
    });

    return NextResponse.json({ success: true, category }, { status: 201 });
  } catch (error: any) {
    console.error("Error creating category:", error);
    return NextResponse.json({ error: error.message || "Failed to create category" }, { status: 500 });
  }
}
