// src/lib/sync/command-types.ts - Facts about sync command types that tools outside the app (backup, restore,
// reconciliation scripts) need without loading the posting service and sign-in code.

/** Commands whose main document carries the command id (so its arrival in a copy can be recognised). */
export const CREATES_DOCUMENT = new Set(["CREATE_DOCUMENT", "SCREEN_PURCHASE", "PAY_SUPPLIER", "SCREEN_SALE", "RECEIVE_PAYMENT"]);
