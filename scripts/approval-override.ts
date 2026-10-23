// scripts/approval-override.ts - Enable or disable the own-approval override (decision D-2, Report 25), at the server.
// Usage (on the main server; single business uses DATABASE_URL, a multi-business server names the business):
//   npx tsx scripts/approval-override.ts status                               [--tenant <slug>]
//   npx tsx scripts/approval-override.ts enable <admin-email> "<reason>"      [--tenant <slug>]
//   npx tsx scripts/approval-override.ts disable "<reason>"                   [--tenant <slug>]
// The override lets that one administrator approve a stock issue, press loss or stock count they prepared, each
// time with a written reason. Every change and every use is audited and listed in Reports -> Own-approval overrides.
import os from "node:os";
import { createPrismaClient } from "../src/lib/prisma";
import { tenancyMode } from "../src/lib/tenancy/config";
import { getTenantBySlug } from "../src/lib/tenancy/registry";
import { getSetting, setApprovalOverride } from "../src/lib/accounting/setup";

async function main() {
  const args = process.argv.slice(2);
  const t = args.indexOf("--tenant");
  const slug = t >= 0 ? args[t + 1] : undefined;
  const [cmd, a, b] = t >= 0 ? args.filter((_, i) => i !== t && i !== t + 1) : args;
  let url: string;
  if (tenancyMode() === "multi") {
    if (!slug) throw new Error("Name the business with --tenant <slug>");
    const tenant = await getTenantBySlug(slug);
    if (!tenant) throw new Error(`No business with slug ${slug}`);
    url = tenant.dbUrl;
  } else {
    if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to this business's database");
    url = process.env.DATABASE_URL;
  }
  if ((process.env.CRM_NODE_ROLE ?? "cloud") !== "cloud") throw new Error("Run this on the main server; settings reach desktops by sync");
  const db = createPrismaClient(url);
  try {
    const changedBy = `operator:${os.userInfo().username}`;
    if (cmd === "status") {
      const id = String(await getSetting(db, "SELF_APPROVAL_OVERRIDE_USER"));
      const user = id ? await db.user.findUnique({ where: { id }, select: { name: true, email: true } }) : null;
      console.log(user ? `Override enabled for ${user.name} <${user.email}>` : "Override off for everyone");
    } else if (cmd === "enable") {
      if (!a || !b) throw new Error('enable <admin-email> "<reason>"');
      const user = await db.user.findUnique({ where: { email: a.toLowerCase() } });
      if (!user) throw new Error("No user with that e-mail in this business");
      await setApprovalOverride(db, { userId: user.id, changedBy, reason: b });
      console.log(`Override enabled for ${user.name}`);
    } else if (cmd === "disable") {
      if (!a) throw new Error('disable "<reason>"');
      await setApprovalOverride(db, { userId: null, changedBy, reason: a });
      console.log("Override off for everyone");
    } else {
      throw new Error("Commands: status, enable, disable");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
