import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const SECRET_VALUES = {
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key",
  DATABASE_URL: "postgresql://synthetic.invalid/database",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
  PROFILE_ENGINE_URL: "https://profile-engine.synthetic.invalid",
  PROFILE_ENGINE_SHARED_SECRET: "synthetic-profile-engine-shared-secret",
} as const;

function configureStaging() {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("RUNTIME_ADAPTER", "supabase");
  vi.stubEnv("CONTEXT", "deploy-preview");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "");
  for (const [name, value] of Object.entries(SECRET_VALUES)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deployment health", () => {
  it("reports a configured staging runtime without returning environment values", async () => {
    configureStaging();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      stagingPreview: true,
      appEnvironment: "staging",
      runtimeAdapter: "supabase",
      localPersistenceEnabled: false,
      localAdapterExplicitlyAllowed: false,
      missingEnvironmentVariables: [],
      invalidEnvironmentVariables: [],
      profileEngine: { healthStatus: 200, unauthorizedComputeStatus: 401 },
    });
    for (const value of Object.values(SECRET_VALUES)) expect(serialized).not.toContain(value);
  });

  it("returns only missing variable names when staging configuration is incomplete", async () => {
    configureStaging();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("redacted dependency failure")));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.missingEnvironmentVariables).toEqual(["DATABASE_URL"]);
    expect(body.profileEngine).toEqual({ healthStatus: null, unauthorizedComputeStatus: null });
    expect(JSON.stringify(body)).not.toContain("redacted dependency failure");
  });

  it("never enables local persistence in a hosted preview", async () => {
    configureStaging();
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.localPersistenceEnabled).toBe(false);
  });
});
