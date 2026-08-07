import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/renderer/vitest.setup.ts"],
    exclude: ["**/node_modules/**", "e2e/**", "dist/**", "release/**"],
  },
});
