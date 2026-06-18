// prisma.config.ts - Prisma 7 configuration
import { defineConfig } from "prisma/config";

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || "file:./dev.db",
  },
});