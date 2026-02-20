import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/e2e/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    pool: "forks",
    maxWorkers: 1,
  },
});
