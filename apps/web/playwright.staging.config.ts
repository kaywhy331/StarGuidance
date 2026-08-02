import { defineConfig, devices } from "@playwright/test";

/**
 * Credential-gated configuration for the deployed staging preview.
 *
 * Traces, videos, screenshots, and HTML reports are disabled on purpose: those
 * artefacts capture cookies, storage state, and request headers, and this suite
 * authenticates with real Supabase sessions. The workflow uploads only the
 * redacted Markdown summary.
 */
const baseURL = process.env.STAGING_BASE_URL;
if (!baseURL) throw new Error("STAGING_BASE_URL must name the deploy preview to verify");

export default defineConfig({
  testDir: "./tests/staging",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "staging-chromium", use: { ...devices["Desktop Chrome"] } }],
});
