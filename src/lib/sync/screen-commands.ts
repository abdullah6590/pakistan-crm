// src/lib/sync/screen-commands.ts - Bills and payments from the Sales and Purchases screens entered on a computer that
// works from its local copy (Report 30 §8, protocol 2). The entry is queued for the server under the screen's one-time
// id, so a double click or a retry queues it once; the server posts it with the same rules as online.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/accounting/server";
import { localDevice } from "./local";
import { OutboxError, submitCommand } from "./outbox";

type ScreenCommand = "SCREEN_PURCHASE" | "PAY_SUPPLIER" | "SCREEN_SALE" | "RECEIVE_PAYMENT";

export async function queueScreenEntry(type: ScreenCommand, actorUserId: string, input: Record<string, unknown>, requestId?: string) {
  try {
    if (requestId) {
      const again = await prisma.outboxCommand.findUnique({ where: { id: requestId } });
      if (again) return NextResponse.json(serialize({ pending: true, entry: again, repeated: true }), { status: 200 });
    }
    const entry = await submitCommand(prisma, localDevice(), { ...(requestId ? { id: requestId } : {}), type, actorUserId, input });
    return NextResponse.json(serialize({ pending: true, entry }), { status: 201 });
  } catch (error) {
    if (error instanceof OutboxError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
