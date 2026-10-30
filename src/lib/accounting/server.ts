// src/lib/accounting/server.ts - Glue between route handlers and the posting service.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";
import { ensureAccountingSetup } from "./setup";
import { PostingError } from "./posting";
import { isAuthority } from "@/lib/sync/local";

let setup: Promise<void> | null = null;

/** System accounts and the main store are created once per server process (idempotent upserts). */
export function accountingReady(): Promise<void> {
  // Replicas receive the system accounts from the cloud; creating them locally would clash on first sync
  if (!isAuthority()) return Promise.resolve();
  setup ??= ensureAccountingSetup(prisma).catch((e) => {
    setup = null;
    throw e;
  });
  return setup;
}

export function accountingError(error: unknown) {
  if (error instanceof PostingError) return NextResponse.json({ error: error.message, ...(error.details !== undefined ? { details: error.details } : {}) }, { status: error.status });
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return NextResponse.json({ error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Validation error" }, { status: 400 });
  }
  return handleApiError(error);
}

/** JSON-safe copy: journal amounts are stored as bigint paisa. */
export function serialize<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
