import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // e2e/**/*.spec.ts are Playwright specs (see playwright.config.ts, testDir: "./e2e").
    // Vitest's default include glob (**/*.{test,spec}.ts) matches them too, so without
    // this exclude `vitest run` tries to collect them and crashes on test.describe()
    // being called outside the Playwright test runner.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
