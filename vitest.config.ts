import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig.json sets "jsx": "preserve" for Next.js's own SWC compiler. Vite/vitest's
  // oxc-based transform reads that same tsconfig and, left unset, also leaves JSX
  // un-transformed — this only affects the vitest test runner, not the Next.js build.
  // Needed so tests can import .tsx Server/Client Components directly (e.g.
  // src/app/(main)/outreach/__tests__/OutreachContent.test.ts importing
  // ../OutreachContent.tsx).
  oxc: {
    jsx: { runtime: "automatic" },
  },
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
