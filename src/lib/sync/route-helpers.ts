// src/lib/sync/route-helpers.ts - Authenticate a device request and run it inside its tenant (Report 21 §5).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tenancyMode, DEFAULT_TENANT_ID } from "@/lib/tenancy/config";
import { runWithTenant } from "@/lib/tenancy/context";
import { getTenant } from "@/lib/tenancy/registry";
import { authenticateDevice, SyncAuthError } from "./server";
import { localDevice } from "./local";
import { checkProtocol } from "./commands";
import { nodeRole } from "@/lib/tenancy/config";

type DeviceRow = Awaited<ReturnType<typeof authenticateDevice>>;

export async function withDevice(request: Request, fn: (device: DeviceRow) => Promise<Response>): Promise<Response> {
  const problem = checkProtocol(request.headers.get("x-crm-protocol"));
  if (problem) return NextResponse.json({ error: problem.error, code: problem.code }, { status: problem.status });
  const role = nodeRole();
  if (role === "device") return NextResponse.json({ error: "This computer does not accept sync from other devices" }, { status: 409 });
  if (role === "hub") {
    // An office hub holds one business: the computer must belong to it and be registered to this hub
    const own = process.env.CRM_TENANT_ID || DEFAULT_TENANT_ID;
    if ((request.headers.get("x-crm-tenant") || DEFAULT_TENANT_ID) !== own) return NextResponse.json({ error: "Unknown business" }, { status: 401 });
    return runWithTenant(DEFAULT_TENANT_ID, async () => {
      const auth = request.headers.get("authorization") ?? "";
      let device: DeviceRow;
      try {
        device = await authenticateDevice(prisma, auth.startsWith("Device ") ? auth.slice(7) : null);
      } catch (e) {
        if (e instanceof SyncAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
        throw e;
      }
      if (device.hubId !== localDevice().id) return NextResponse.json({ error: "This computer is not registered to this office server" }, { status: 403 });
      return fn(device);
    });
  }
  const tenantId = request.headers.get("x-crm-tenant") || DEFAULT_TENANT_ID;
  if (tenancyMode() === "single" && tenantId !== DEFAULT_TENANT_ID) return NextResponse.json({ error: "Unknown business" }, { status: 401 });
  const tenant = await getTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: "Unknown business" }, { status: 401 });
  // A suspended business keeps its data; its devices keep their unsent entries until it is reactivated
  if (tenant.status !== "ACTIVE") return NextResponse.json({ error: "This business account is not active" }, { status: 403 });
  return runWithTenant(tenantId, async () => {
    const auth = request.headers.get("authorization") ?? "";
    let device: DeviceRow;
    try {
      device = await authenticateDevice(prisma, auth.startsWith("Device ") ? auth.slice(7) : null);
    } catch (e) {
      if (e instanceof SyncAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
      throw e;
    }
    return fn(device);
  });
}
