// src/lib/accounting/server.ts - Glue between route handlers and the posting service.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";
import { ensureAccountingSetup } from "./setup";
import { PostingError } from "./posting";
import { isAuthority } from "@/lib/sync/local";
import { ensureCatalog } from "@/lib/catalog/ensure";

let setup: Promise<void> | null = null;

/** System accounts and the main store are created once per server process (idempotent upserts). */
export function accountingReady(): Promise<void> {
  // Replicas receive the system accounts from the cloud; creating them locally would clash on first sync
  if (!isAuthority()) return Promise.resolve();
  // Then every product gets its unit profile and short number, and every party its number (Report 32 phase 1)
  setup ??= ensureAccountingSetup(prisma).then(() => ensureCatalog(prisma)).then(() => undefined).catch((e) => {
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

/** For server-rendered pages that read products or parties directly: make sure the one-time catch-up (numbers,
 *  unit profiles) has run, without letting a setup problem break the page itself (the API routes still report it). */
export async function catalogReady(): Promise<void> {
  try {
    await accountingReady();
  } catch (e) {
    console.error("[catalog] setup not ready:", e instanceof Error ? e.message : e);
  }
}
