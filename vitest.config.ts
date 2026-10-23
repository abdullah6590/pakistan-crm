import { defineConfig } from "vitest/config";
import { randomBytes } from "node:crypto";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Modules that load src/lib/auth.ts require a signing secret; tests get a random one per run.
    env: { JWT_SECRET: randomBytes(32).toString("base64url") },
    // Integration tests build real databases, run scrypt and start PowerShell (DPAPI). On a small machine
    // (4 threads) full parallelism starved workers; two at a time with a 30 s limit is deterministic (D-019).
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
