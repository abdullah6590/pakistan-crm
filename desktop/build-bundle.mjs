// desktop/build-bundle.mjs - Assemble what the installer ships (desktop/bundle): the Next.js standalone server with
// its static files, the database migrations, the start script, and the Node runtime this build was tested with.
// It refuses to finish if any database, backup, environment or key file would be shipped.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findPrivate } from "./check-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(here, "bundle");
const dist = path.join(root, ".next-desktop");

// Start clean: an old bundle or build must not be picked up by the build's file tracing
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(dist, { recursive: true, force: true });
// Cargo checks and earlier packages can leave generated app/node staging copies in either profile. If a debug copy
// remains, Next's runtime migration-directory trace can mistake its duplicated prisma/migrations tree for an input
// and reproduce the whole top-level desktop directory in the standalone output.
for (const profile of ["debug", "release"]) {
  for (const copy of ["app", "node"]) {
    fs.rmSync(path.join(here, "src-tauri", "target", profile, copy), { recursive: true, force: true });
  }
}
console.log("1/4 Building the server (standalone, separate build folder .next-desktop)");
execFileSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: root, stdio: "inherit", env: { ...process.env, CRM_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" },
});

console.log("2/4 Assembling desktop/bundle");
fs.rmSync(out, { recursive: true, force: true });
const app = path.join(out, "app");
fs.cpSync(path.join(dist, "standalone"), app, { recursive: true, dereference: true });
fs.cpSync(path.join(dist, "static"), path.join(app, ".next-desktop", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(app, "public"), { recursive: true });
fs.cpSync(path.join(root, "prisma", "migrations"), path.join(app, "prisma", "migrations"), { recursive: true });
fs.copyFileSync(path.join(here, "app-entry.cjs"), path.join(app, "app-entry.cjs"));
// Next's pre-rendered page cache uses folders named "$", which the installer generator turns into NSIS escapes
// ("$\r…"). The server renders those pages on demand instead (verified: identical responses), so it is left out.
fs.rmSync(path.join(app, ".next-desktop", "server", "route-cache"), { recursive: true, force: true });
fs.mkdirSync(path.join(out, "node"), { recursive: true });
fs.copyFileSync(process.execPath, path.join(out, "node", "node.exe"));

console.log("3/4 Checking that nothing private would be shipped");
// Data, backups, keys, environment files and sources must never be in the bundle (D-026). If any is found, the
// bundle and the standalone copy are deleted and the build stops; nothing is "cleaned up" silently.
const found = findPrivate(app);
if (found.length) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(path.join(dist, "standalone"), { recursive: true, force: true });
  throw new Error(`Refusing to ship (bundle deleted): ${found.join(", ")}`);
}

console.log("4/4 Done");
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(JSON.stringify({ bundle: out, appMB: Math.round(size(app) / 1048576), nodeMB: Math.round(size(path.join(out, "node")) / 1048576), privateFilesFound: 0 }, null, 2));
