import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Local continuity qualification only. No hosted URL or optional providers.
export default defineConfig({
  ...base,
  testMatch: /guest-(bootstrap-recovery|save-recovery|reading|lifecycle)\.spec\.ts/,
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: "http://127.0.0.1:3133" },
  webServer: [
    {
      command:
        "python3 -m uvicorn profile_engine.main:app --app-dir ../profile-engine/src --host 127.0.0.1 --port 8033",
      reuseExistingServer: false,
      url: "http://127.0.0.1:8033/health",
    },
    {
      command:
        "corepack pnpm exec next build && corepack pnpm exec next start --hostname 127.0.0.1 --port 3133",
      env: {
        APP_ENV: "test",
        RUNTIME_ADAPTER: "local",
        ALLOW_LOCAL_RUNTIME_ADAPTER: "true",
        AI_PROVIDER: "disabled",
        AI_SAFETY_EVALUATION_APPROVED: "false",
        ENABLE_PROFILE_REPORTS: "false",
        NEXT_PUBLIC_ENABLE_PROFILE_REPORTS: "false",
        READING_AUDIO_PROVIDER: "disabled",
        GUEST_TRIAL_SECRET: Buffer.alloc(32, 31).toString("base64"),
        PROFILE_ENGINE_URL: "http://127.0.0.1:8033",
      },
      reuseExistingServer: false,
      timeout: 420_000,
      stdout: "pipe",
      url: "http://127.0.0.1:3133",
    },
  ],
});
