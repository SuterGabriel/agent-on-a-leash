import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@leash/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    // The full suite runs many files at once; 5 s per test is too tight under that load (each passes in < 1 s alone).
    // Performance limits inside the tests are unchanged.
    testTimeout: 20_000,
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
