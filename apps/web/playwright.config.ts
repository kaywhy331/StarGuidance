import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Firefox and WebKit compete heavily for CPU with the production Next.js
  // server on shared CI runners. Two workers keep the full browser matrix
  // parallel without starving individual navigations past the test timeout.
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "python3 -m uvicorn profile_engine.main:app --app-dir ../profile-engine/src --port 8000",
      reuseExistingServer: false,
      url: "http://127.0.0.1:8000/health",
    },
    {
      command: "corepack pnpm exec next build && corepack pnpm exec next start --port 3100",
      env: {
        APP_ENV: "test",
        RUNTIME_ADAPTER: "local",
        ALLOW_LOCAL_RUNTIME_ADAPTER: "true",
        AI_PROVIDER: "disabled",
        PAYMENTS_PROVIDER: "local",
        ENABLE_PROFILE_REPORTS: "true",
        NEXT_PUBLIC_ENABLE_PROFILE_REPORTS: "true",
        PROFILE_ENGINE_URL: "http://127.0.0.1:8000",
      },
      reuseExistingServer: false,
      timeout: 180_000,
      url: "http://127.0.0.1:3100",
    },
  ],
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
