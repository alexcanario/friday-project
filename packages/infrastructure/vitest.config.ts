import { defineConfig } from "vitest/config";

// Git-heavy tests spawn many processes; on the Windows runner they exceed the 5s default.
export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
