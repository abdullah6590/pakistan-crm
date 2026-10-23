// src/lib/dev/reset-guard.ts - Decision D-4 (2026-10-22): erasing or seeding a database is allowed only for a
// disposable local development/test database, named on purpose and confirmed by name. Never in production, never
// on a multi-business server, never on crm.db / dev.db / test.db or anything in backups/. No screen or API calls it.
import path from "node:path";

export class ResetRefused extends Error {}

export function assertDisposableDatabase(url: string | undefined, env: Record<string, string | undefined> = process.env): string {
  if (env.NODE_ENV === "production") throw new ResetRefused("Refused: database reset is disabled in production");
  if ((env.CRM_TENANCY ?? "single").toLowerCase() === "multi") throw new ResetRefused("Refused: never on a multi-business server");
  if (!url || !url.startsWith("file:")) throw new ResetRefused("Refused: set DATABASE_URL to a local file:… database");
  const file = path.resolve(url.slice(5).replace(/^\/\/(?=[A-Za-z]:)/, ""));
  const name = path.basename(file);
  if (!/\.(scratch|sandbox)\.db$/i.test(name)) {
    throw new ResetRefused(`Refused: only a disposable database named *.scratch.db or *.sandbox.db can be reset (got ${name})`);
  }
  if (file.split(path.sep).some((part) => part.toLowerCase() === "backups")) throw new ResetRefused("Refused: never inside a backups folder");
  if (env.CRM_CONFIRM_RESET !== name) throw new ResetRefused(`Refused: confirm by setting CRM_CONFIRM_RESET=${name}`);
  return file;
}
