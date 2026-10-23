// src/lib/sync/local.ts - Identity of this node and the rule that only the cloud writes to the ledger.
import { nodeRole } from "@/lib/tenancy/config";
import type { LocalDevice } from "./outbox";

/** True on the cloud (the only ledger authority). Devices and hubs queue commands instead. */
export function isAuthority(): boolean {
  return nodeRole() === "cloud";
}

/** This computer's registered identity, provided by the desktop launcher (Report 21 §5). */
export function localDevice(): LocalDevice {
  const id = process.env.CRM_DEVICE_ID;
  const code = process.env.CRM_DEVICE_CODE;
  if (!id || !code) throw new Error("This computer is not registered as a device (CRM_DEVICE_ID / CRM_DEVICE_CODE missing)");
  return { id, code };
}

export const OFFLINE_ONLY_MESSAGE = "This change needs the main server and is not available on this computer while it works from its local copy. Entries such as invoices, receipts and stock movements can still be made and will sync.";
