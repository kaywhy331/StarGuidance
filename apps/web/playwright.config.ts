import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Long ritual flows run against the production Next.js server in the same
  // process budget as the browsers. Local workspaces may share that budget
  // with other preview/build processes, so they serialize by default. CI may
  // override this per lane; animation-heavy browser lanes use one worker and
  // split longer engine inventories across isolated production servers.
  // CI gives WebKit several separate one-worker shards. Concurrent WebKit
  // contexts can exhaust a shared runner, while one process running the full
  // suite accumulates enough contexts to become unstable late in the run.
  workers: process.env.CI ? 2 : 1,
  // WebKit can terminate a long-lived worker after many isolated browser
  // contexts on a shared runner. A single CI retry gets a fresh worker while
  // still requiring every assertion to pass; local runs remain fail-fast.
  retries: process.env.CI ? 1 : 0,
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
        READING_AUDIO_PROVIDER: "fish-audio",
        FISH_AUDIO_API_KEY: "synthetic-fish-test-key",
        FISH_AUDIO_MODEL: "s2-pro",
        FISH_AUDIO_REFERENCE_ID: "synthetic_voice_model_12345678",
        GUEST_TRIAL_SECRET: Buffer.alloc(32, 31).toString("base64"),
        PROFILE_ENGINE_URL: "http://127.0.0.1:8000",
      },
      reuseExistingServer: false,
      // Next's production compilation includes strict type generation for the
      // whole monorepo. Shared developer runners can exceed three minutes even
      // when the build is healthy, so the browser harness must not fail before
      // Next has a chance to report its own result.
      timeout: 420_000,
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
