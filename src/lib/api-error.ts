import { NextResponse } from "next/server";

export function handleApiError(error: any) {
  console.error("[API Error]", error);

  // If it's a known Prisma error
  if (error?.code) {
    switch (error.code) {
      case "P2002":
        return NextResponse.json({ success: false, error: "A record with this value already exists." }, { status: 409 });
      case "P2003":
        return NextResponse.json({ success: false, error: "Foreign key constraint failed. Related record not found." }, { status: 422 });
      case "P2025":
        return NextResponse.json({ success: false, error: "Record not found." }, { status: 404 });
      default:
        // Log the code internally but don't expose it to the user
        return NextResponse.json({ success: false, error: "Database constraint error." }, { status: 500 });
    }
  }

  // Business logic errors thrown explicitly
  if (error instanceof Error) {
    if (error.message.includes("Insufficient stock") || error.message.includes("is inactive") || error.message.includes("not found")) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
  }

  // Fallback generic error
  return NextResponse.json({ success: false, error: "An unexpected internal error occurred." }, { status: 500 });
}
