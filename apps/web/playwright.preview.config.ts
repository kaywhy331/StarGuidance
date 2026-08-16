import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DEPLOY_PREVIEW_URL;
if (!baseURL) throw new Error("DEPLOY_PREVIEW_URL is required for preview screenshots.");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "preview-visual.spec.ts",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
