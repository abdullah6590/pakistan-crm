// scripts/reset-password.ts - Set a new password for an account on this computer's database, when it has been
// forgotten. The new password is typed by its owner at the prompt (hidden, twice) and is never shown, logged or
// stored in readable form. A backup of the database is taken first and the change is audited.
// Usage (in a terminal on the computer that holds the database, from the project folder):
//   npx tsx scripts/reset-password.ts <email>
// The database is DATABASE_URL, or the one named in .env.local. A multi-business server is refused.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { hash } from "bcryptjs";
import { createClient } from "@libsql/client";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error("Set DATABASE_URL, or run this from the project folder (it reads .env.local)");
  return m[1];
}

/** Read one line without echoing it when typed at a terminal; plain line reading otherwise (scripted tests). */
function ask(question: string, lines?: AsyncIterator<string>): Promise<string> {
  if (lines) return lines.next().then((r) => (r.done ? "" : r.value));
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) throw new Error("Usage: npx tsx scripts/reset-password.ts <email>");
  if ((process.env.CRM_TENANCY ?? "single").toLowerCase() === "multi") throw new Error("On a multi-business server the business's administrator resets passwords");
  const url = databaseUrl();
  if (!url.startsWith("file:")) throw new Error("Only a database file on this computer can be changed with this tool");
  const file = path.resolve(url.slice(5).replace(/^\/\/(?=[A-Za-z]:)/, ""));
  if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
  const db = createClient({ url: `file:${file.replace(/\\/g, "/")}`, encryptionKey: process.env.CRM_DB_ENCRYPTION_KEY || undefined });
  try {
    const user = (await db.execute({ sql: "SELECT id, name, isActive FROM users WHERE lower(email) = ?", args: [email] })).rows[0];
    if (!user) throw new Error(`No account with e-mail ${email} in ${path.basename(file)}`);
    console.log(`Account: ${user.name} <${email}> in ${path.basename(file)}${Number(user.isActive) ? "" : " (deactivated)"}`);

    const lines = process.stdin.isTTY ? undefined : readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    const first = await ask("New password (at least 10 characters, not shown): ", lines);
    const second = await ask("Type it again: ", lines);
    if (first !== second) throw new Error("The two passwords do not match; nothing was changed");
    if (first.length < 10) throw new Error("Use at least 10 characters; nothing was changed");
    if (first.toLowerCase().includes(email.split("@")[0])) throw new Error("Do not use your e-mail name in the password; nothing was changed");

    // A consistent backup first, so the change can always be undone
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(path.dirname(file), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${path.basename(file, ".db")}.backup-${stamp}-before-password-reset.db`);
    await db.execute({ sql: "VACUUM INTO ?", args: [backup] });

    const hashed = await hash(first, 12);
    const tx = await db.transaction("write");
    await tx.execute({ sql: "UPDATE users SET password = ?, updatedAt = ? WHERE id = ?", args: [hashed, new Date().toISOString(), user.id] });
    await tx.execute({
      sql: `INSERT INTO audit_logs (id, entity, entityId, action, userId, reason, createdAt) VALUES (?, 'User', ?, 'RESET_PASSWORD', ?, ?, CURRENT_TIMESTAMP)`,
      args: [crypto.randomUUID(), user.id, `operator:${os.userInfo().username}`, "Forgotten password reset at this computer"],
    });
    await tx.commit();
    console.log(`Password changed. Backup taken first: ${backup}`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
