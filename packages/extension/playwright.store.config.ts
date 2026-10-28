import { defineConfig } from "@playwright/test";

/** Web Store screenshots of the real extension: pnpm --filter @squashflow/extension store:screenshots */
export default defineConfig({
  testDir: "store",
  timeout: 60_000,
  reporter: "list",
});
