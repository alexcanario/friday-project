import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    // Docker tests share one daemon and the cleanup test inspects it: run files one by one.
    fileParallelism: false,
  },
});
