// desktop/check-bundle.mjs - What must never be in desktop/bundle/app: data, backups, keys, environment files and
// sources (D-026), and folders named "$" that break the installer generator (D-030). Used by build-bundle.mjs when
// the bundle is made, and run again by Tauri just before it packages the installer, because running the server from
// the bundle folder (a test) writes such a page cache into it (D-031). Run directly it only refuses; it deletes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const forbiddenFile = /(\.db|\.db-wal|\.db-shm|\.bak|\.pkbk|\.sqlite|\.pem|\.key)$|^\.env/i;
const forbiddenTopDir = new Set(["backups", "recovery", "restore-drill", "audit-reports", "desktop", "src", "scripts", ".git"]);

export function findPrivate(app) {
  const found = [];
  for (const e of fs.readdirSync(app, { withFileTypes: true })) if (e.isDirectory() && forbiddenTopDir.has(e.name)) found.push(e.name + "/");
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && e.name.includes("$")) found.push(`${path.relative(app, p)} (a "$" folder breaks the installer)`);
      if (e.isDirectory()) scan(p);
      else if (forbiddenFile.test(e.name)) found.push(path.relative(app, p));
    }
  };
  scan(app);
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle", "app");
  const found = fs.existsSync(app) ? findPrivate(app) : ["desktop/bundle/app is missing: run npm run bundle"];
  if (found.length) {
    console.error(`Refusing to package the installer. Rebuild the bundle (npm run build); do not run tests from it before packaging:\n  ${found.slice(0, 10).join("\n  ")}${found.length > 10 ? `\n  … and ${found.length - 10} more` : ""}`);
    process.exit(1);
  }
  console.log("Bundle check: nothing private, no \"$\" folders");
}
