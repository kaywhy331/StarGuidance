import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const transaction = Object.assign(vi.fn(), { unsafe: vi.fn() });
  const client = {
    unsafe: vi.fn(),
    begin: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, transaction };
});

vi.mock("@starguidance/database", () => ({
  createDatabaseClient: () => database.client,
}));

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
  vi.stubEnv("SITE_ID", "synthetic-netlify-site-id");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "");
  for (const [name, value] of Object.entries(SECRET_VALUES)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
  database.client.begin.mockImplementation(
    async (work: (tx: typeof database.transaction) => Promise<void>) => work(database.transaction),
  );
  database.client.end.mockResolvedValue(undefined);
  database.transaction.mockResolvedValue([]);
  database.transaction.unsafe.mockResolvedValue([]);
});

describe("deployment health", () => {
  it("reports a configured staging runtime without returning environment values", async () => {
    configureStaging();
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
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
      profileEngine: {
        healthStatus: 200,
        unauthorizedComputeStatus: 401,
        authorizedComputeStatus: 200,
      },
      database: {
        connection: true,
        schemaReady: true,
        rlsReady: true,
        actorTransactionReady: true,
      },
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
    expect(body.profileEngine).toEqual({
      healthStatus: null,
      unauthorizedComputeStatus: null,
      authorizedComputeStatus: null,
    });
    expect(body.database).toEqual({
      connection: false,
      schemaReady: false,
      rlsReady: false,
      actorTransactionReady: false,
    });
    expect(JSON.stringify(body)).not.toContain("redacted dependency failure");
  });

  it("never enables local persistence in a hosted preview", async () => {
    configureStaging();
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.localPersistenceEnabled).toBe(false);
  });

  it("fails closed when the authoritative staging schema is not applied", async () => {
    configureStaging();
    database.client.unsafe.mockResolvedValue([{ schema_ready: false, rls_ready: false }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.database).toEqual({
      connection: true,
      schemaReady: false,
      rlsReady: false,
      actorTransactionReady: false,
    });
  });
});
